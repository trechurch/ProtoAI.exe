const https = require("https");
const path = require("path");
const WorkflowResult = require("../WorkflowResult");

// DeepSearchWorkflow — uses free APIs to perform real lookups and synthesize results.
// - Wikipedia Summary API (no key)
// - DuckDuckGo Instant Answer (lite) (no key)
// - arXiv API (preprint research)

const WIKI_SEARCH = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srsearch=`;
const WIKI_SUMMARY = `https://en.wikipedia.org/api/rest_v1/page/summary/`;
const DDUCKGO = `https://api.duckduckgo.com/?q=`;
const ARXIV = `http://export.arxiv.org/api/query?search_query=`;

function fetchJSON(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout")), timeout);
    https.get(url, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    }).on("error", err => { clearTimeout(timer); reject(err); });
  });
}

function parseArxiv(xml) {
  const entries = [];
  const regex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const title = (match[1].match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || "";
    const summary = (match[1].match(/<summary[^>]*>([\s\S]*?)<\/summary>/) || [])[1] || "";
    const authors = match[1].match(/<name>([\s\S]*?)<\/name>/g) || [];
    entries.push({
      title: title.trim(),
      summary: summary.trim().slice(0, 300),
      authors: authors.map(a => a.replace(/<\/?name>/g, "").trim()).slice(0, 3),
    });
  }
  return entries;
}

function fetchArxiv(query) {
  return new Promise((resolve, reject) => {
    const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&max_results=3`;
    https.get(url, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try { resolve(parseArxiv(data)); }
        catch(e) { resolve([]); }
      });
    }).on("error", () => resolve([]));
  });
}

async function runSources(query) {
  const results = { query, sources: {} };

  // 1. Wikipedia search
  try {
    const wikiRes = await fetchJSON(`${WIKI_SEARCH}${encodeURIComponent(query)}`, 8000);
    if (wikiRes.query?.search?.length) {
      const top = wikiRes.query.search[0];
      results.sources.wikipedia = {
        title: top.title,
        snippet: top.snippet.replace(/<\/?[^>]+(>|$)/g, "").slice(0, 400),
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(top.title)}`,
      };
    }
  } catch(e) { results.sources.wikipedia = { error: "unavailable" }; }

  // 2. DuckDuckGo instant answers
  try {
    const ddgoRes = await fetchJSON(`${DDUCKGO}${encodeURIComponent(query)}&format=json`, 8000);
    if (ddgoRes.Abstract) {
      results.sources.duckduckgo = {
        title: ddgoRes.Heading || "DuckDuckGo",
        answer: ddgoRes.Abstract.slice(0, 500),
        url: ddgoRes.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
      };
    }
  } catch(e) { results.sources.duckduckgo = { error: "unavailable" }; }

  // 3. arXiv research papers
  try {
    const papers = await fetchArxiv(query);
    if (papers.length) {
      results.sources.arxiv = papers;
    }
  } catch(e) { results.sources.arxiv = []; }

  // 4. Web search suggestions (DuckDuckGo HTML)
  results.sources.fallbackUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=web`;

  return results;
}

function renderResults(sources) {
  let md = "";
  md += `# Deep Search Results: "**${sources.query}**"\n\n`;

  const wiki = sources.sources.wikipedia;
  if (wiki && !wiki.error) {
    md += `## 📖 Wikipedia\n`;
    md += `**[${wiki.title}](${wiki.url})**\n`;
    md += `${wiki.snippet}\n\n`;
  }

  const ddgo = sources.sources.duckduckgo;
  if (ddgo && !ddgo.error) {
    md += `## 🔍 DuckDuckGo\n`;
    md += `**${ddgo.title}**\n`;
    md += `${ddgo.answer}\n\n`;
  }

  const arxiv = sources.sources.arxiv;
  if (arxiv && arxiv.length) {
    md += `## 📄 Research Papers (arXiv)\n`;
    arxiv.forEach(p => {
      md += `### ${p.title}\n`;
      if (p.authors.length) md += `_${p.authors.join(", ")}_\n`;
      md += `${p.summary}\n\n`;
    });
  }

  md += `---\n`;
  md += `🔎 [Perform broader web search](${sources.fallbackUrl})\n`;
  md += `_Tip: Ask me to synthesize these results or dig deeper into any section._`;

  return md;
}

class DeepSearchWorkflow {
  async run(context) {
    const { query } = context || {};
    if (!query) {
      return new WorkflowResult("error", { error: "No search query provided" });
    }

    try {
      const results = await runSources(query);
      const markdown = renderResults(results);
      return new WorkflowResult("ok", { markdown, raw: results });
    } catch (err) {
      return new WorkflowResult("error", {
        error: "Deep search failed",
        detail: err.message,
      });
    }
  }
}

module.exports = DeepSearchWorkflow;

# SDOA v1.2 compliant — Orchestration Service
from base import Service

class ExplainModuleWorkflow(Service):
    MANIFEST = {
        "id": "ExplainModuleWorkflow",
        "runtime": "Python",
        "version": "1.0.0",
        "dependencies": ["QmdAdapter", "LlmBridge"]
    }

    def explain(self, module_id: str):
        qmd = self.registry.get("QmdAdapter")
        llm = self.registry.get("LlmBridge")

        # 1. Acquire Context via qmd (High-precision retrieval)
        code_snippets = qmd.query(f"SELECT content FROM snippets WHERE file LIKE '%{module_id}%'")
        manifest_data = qmd.search(f"What are the dependencies of {module_id}?")

        # 2. Synthesize Prompt
        prompt = f"""
        Explain this SDOA module.
        CODE SNIPPETS: {code_snippets}
        MANIFEST CONTEXT: {manifest_data}
        """

        # 3. Generate via Bridge
        response = llm.generate(
            prompt=prompt, 
            systemPrompt="Explain the architectural role and logic of the provided code."
        )

        return response['text']
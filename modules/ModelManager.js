/**
 * SDOA Model Inventory & Mapping Module
 */
/**
 * @SdoaManifest
 * Name: ModelManager
 * Type: UI_MODULE
 * Version: 0.1.4
 * Description: Manages the draggable model table and behavioral mapping.
 * Capabilities: inventory.render, inventory.reorder, inventory.mapBehavior
 * Dependencies: BackendConnector, FileManager
 * Author: Jackson Danner Church III
 */

/**
 * @SdoaDocs
 * This module orchestrates the transition from flat settings to a 
 * failover-priority model system. It specifically supports archetypes
 * like "Coding Super Hero" by mapping specific model IDs to behavioral roles.
 */

class ModelInventory {
  constructor() {
    this.models = [
	{ id: "nv-super-free", 
		name: "nvidia/nemotron-3-super-120b-a12b:free", 
		active: true, api: "openrouter", 
		category: "research", cost: 0 },
	{ id: "nv-nano30-free", 
		name: "nvidia/nemotron-3-nano-30b-a3b:free", 
		active: true, api: "openrouter", 
		category: "coding", cost: 0 },
	{ id: "gpt-oss-120-free", 
		name: "openai/gpt-oss-120b:free", 
		active: true, api: "openrouter", 
		category: "chat", cost: 0 },
	{ id: "nv-nano12vl-free", 
		name: "nvidia/nemotron-nano-12b-v2-vl:free", 
		active: true, api: "openrouter", 
		category: "chat", cost: 0 },
	{ id: "nv-nano9-free", 
		name: "nvidia/nemotron-nano-9b-v2:free", 
		active: true, api: "openrouter", 
		category: "chat", cost: 0 },
	{ id: "gpt-oss-20-free", 
		name: "openai/gpt-oss-20b:free", 
		active: true, api: "openrouter", 
4		category: "chat", cost: 0 },
	{ id: "openrouter-free", 
		name: "openrouter/free", 
		active: true, api: "openrouter", 
		category: "router", cost: 0 },
	{ id: "qwen-coder-30b", 
		name: "qwen/qwen3-coder-30b-a3b-instruct", 
		active: true, api: "openrouter",
		category: "coding", cost: 0 },
	{ id: "qwen-coder-next", 
		name: "qwen/qwen3-coder-next", 
		active: true, api: "openrouter", 
		category: "coding", cost: 0 },
	{ id: "qwen-coder-flash", 
		name: "qwen/qwen3-coder-flash", 
		active: true, api: "openrouter", 
		category: "coding", cost: 0 },
	{ id: "qwen-coder", 
		name: "qwen/qwen3-coder", 
		active: true, api: "openrouter", 
		category: "coding", cost: 0 },
	{ id: "mercury-coder", 
		name: "inception/mercury-coder", 
		active: true, api: "openrouter", 
		category: "coding", cost: 0 },	
	{ id: "grok-code-fast", 
		name: "x-ai/grok-code-fast-1", 
		active: true, api: "openrouter", 
		category: "coding", cost: 0 },
	{ id: "codestral", 
		name: "mistralai/codestral-2508", 
		active: true, api: "openrouter"
		category: "coding", cost: 0 },
	{ id: "kat-coder-pro", 
		name: "kwaipilot/kat-coder-pro-v2", 
		active: true, api: "openrouter", 
		category: "coding", cost: 0 },
	{ id: "solidity-llama", 
		name: "alfredpros/codellama-7b-instruct-solidity", 
		active: true, api: "openrouter", 
		category: "coding", cost: 0 },
	{ id: "deepseek-v32-exp", 
		name: "deepseek/deepseek-v3.2-exp", 
		active: true, api: "openrouter", 
		category: "experimental", cost: 0 },
	{ id: "gemini-20-flash-exp", 
		name: "google/gemini-2.0-flash-exp", 
		active: true, api: "openrouter", 
		category: "experimental", cost: 0 },
	{ id: "gemini-exp-1121", 
		name: "google/gemini-exp-1121", 
		active: true, api: "openrouter", 
		category: "experimental", cost: 0 },
	{ id: "gemini-exp-1114", 
		name: "google/gemini-exp-1114", 
		active: true, api: "openrouter", 
		category: "experimental", cost: 0 },
	{ id: "gemini-flash-15-exp", 
		name: "google/gemini-flash-1.5-exp", 
		active: true, api: "openrouter", 
		category: "experimental", cost: 0 },
	{ id: "gemini-pro-15-exp", 
		name: "google/gemini-pro-1.5-exp", 
		active: true, api: "openrouter", 
		category: "experimental", cost: 0 },
	{ id: "dolphin-venice-free", 
		name: "cognitivecomputations/dolphin-mistral-24b-venice-edition:free", 
		active: true, api: "openrouter", 
		category: "experimental", cost: 0 },
	{ id: "lyria-pro", 
		name: "google/lyria-3-pro-preview", 
		active: true, api: "openrouter", 
		category: "music", cost: 0 },
	{ id: "wan-26", name: "alibaba/wan-2.6", 
		active: true, api: "openrouter", 
		category: "video", cost: 0 },
	{ id: "seedance-pro", 
		name: "bytedance/seedance-1-5-pro", 
		active: true, api: "openrouter", 
		category: "video", cost: 0 },
	{ id: "nv-nano12vl-free2", 
		name: "nvidia/nemotron-nano-12b-v2-vl:free", 
		active: true, api: "openrouter", 
		category: "video", cost: 0 },
	{ id: "sora-2-pro", 
		name: "openai/sora-2-pro", 
		active: true, api: "openrouter", 
		category: "video", cost: 0 },
	{ id: "veo-31", 
		name: "google/veo-3.1", 
		active: true, api: "openrouter", 
		category: "video", cost: 0 },
	{ id: "riverflow-pro", 
		name: "sourceful/riverflow-v2-pro", 
		active: true, api: "openrouter", 
		category: "image", cost: 0 },
	{ id: "riverflow-max", 
		name: "sourceful/riverflow-v2-max-preview", 
		active: true, api: "openrouter", 
		category: "image", cost: 0 },
	{ id: "riverflow-std", 
		name: "sourceful/riverflow-v2-standard-preview", 
		active: true, api: "openrouter", 
		category: "image", cost: 0 },
	{ id: "gemini-25-img", 
		name: "google/gemini-2.5-flash-image-preview", 
		active: true, api: "openrouter", 
		category: "image", cost: 0 },
	{ id: "gemini-31-img", 
		name: "google/gemini-3.1-flash-image-preview", 
		active: true, api: "openrouter", 
		category: "image", cost: 0 },
	{ id: "riverflow-fast", 
		name: "sourceful/riverflow-v2-fast-preview", 
		active: true, api: "openrouter", 
		category: "image", cost: 0 },
	{ id: "flux2-pro", 
		name: "black-forest-labs/flux.2-pro", 
		active: true, api: "openrouter", 
		category: "image", cost: 0 },
	{ id: "gemini-3-img", 
		name: "google/gemini-3-pro-image-preview", 
		active: true, api: "openrouter", 
		category: "image", cost: 0 },
	{ id: "grok-vision-1212", 
		name: "x-ai/grok-2-vision-1212", 
		active: true, api: "openrouter", 
		category: "image", cost: 0 },
	{ id: "grok-vision-beta", 
		name: "x-ai/grok-vision-beta", 
		active: true, api: "openrouter", 
		category: "image", cost: 0 },
	{ id: "llama-90b-vision", 
		name: "meta-llama/llama-3.2-90b-vision-instruct", 
		active: true, api: "openrouter", 
		category: "image", cost: 0 },
	{ id: "yi-vision", 
		name: "01-ai/yi-vision", 
		active: true, api: "openrouter", 
		category: "image", cost: 0 },
	{ id: "nous-vision", 
		name: "nousresearch/nous-hermes-2-vision-7b", 
		active: true, api: "openrouter", 
		category: "image", cost: 0 },
	{ id: "gpt4-vision", 
		name: "openai/gpt-4-vision-preview", 	
		active: true, api: "openrouter", 
		category: "image", cost: 0 },
	{ id: "gpt4o-audio", 
		name: "openai/gpt-4o-audio-preview", 
		active: true, api: "openrouter", 
		category: "audio", cost: 0 },
	{ id: "inflection-voice", 
		name: "inflection/inflection-3-productivity", 
		active: true, api: "openrouter", 
		category: "audio", cost: 0 },
	{ id: "cogito-405b", 
		name: "deepcogito/cogito-v2-preview-llama-405b", 
		active: true, api: "openrouter", 
		category: "audio", cost: 0 },
	{ id: "deephermes", 
		name: "nousresearch/deephermes-3-mistral-24b-preview", 
		active: true, api: "openrouter", 
		category: "audio", cost: 0 },
	{ id: "xiaomi-mimo-pro", 
		name: "xiaomi/mimo-v2-pro", 	
		active: true, api: "openrouter", 
		category: "chat", cost: 0 },
	{ id: "gemini-25-pro", 
		name: "google/gemini-2.5-pro", 
		active: true, api: "openrouter", 
		category: "chat", cost: 0 },	
	{ id: "sonar-reason-pro", 
		name: "perplexity/sonar-reasoning-pro", 
		active: true, api: "openrouter", 	
		category: "research", cost: 0 },
	{ id: "nv-super-paid", 
		name: "nvidia/nemotron-3-super-120b-a12b", 
		active: true, api: "openrouter", 
		category: "research", cost: 0 },
	{ id: "gemini-31-pro-tools", 
		name: "google/gemini-3.1-pro-preview-customtools", 
		active: true, api: "openrouter", 
		category: "chat", cost: 0 },
	{ id: "gemini-31-pro", 
		name: "google/gemini-3.1-pro-preview", 
		active: true, api: "openrouter", 
		category: "chat", cost: 0 },
	{ id: "inflection-3", 
		name: "inflection/inflection-3-productivity", 	
		active: true, api: "openrouter", 
		category: "assistant", cost: 0 },
	{ id: "sonar-pro-search", 
		name: "perplexity/sonar-pro-search", 
		active: true, api: "openrouter", 
		category: "research", cost: 0 },
	{ id: "sonar-pro", 
		name: "perplexity/sonar-pro", 
		active: true, api: "openrouter", 
		category: "chat", cost: 0 },
	{ id: "deepseek-prover", 
		name: "deepseek/deepseek-prover-v2", 
		active: true, api: "openrouter", 
		category: "reasoning", cost: 0 },
	{ id: "gemini-25-pro-prev", 
		name: "google/gemini-2.5-pro-preview", 
		active: true, api: "openrouter", 
		category: "chat", cost: 0 },
	{ id: "gemini-25-pro-prev2", 
		name: "google/gemini-2.5-pro-preview-05-06", 
		active: true, api: "openrouter", 
		category: "chat", cost: 0 },
];
    this.draggedIndex = null;
  }

  render() {
    this.renderInventoryTable();
    this.updateDropdowns();
  }

  renderInventoryTable() {
    const container = document.getElementById('sdoa-model-table');
    if (!container) return;

    container.innerHTML = this.models.map((m, i) => `
      <div class="model-row" draggable="true" data-index="${i}">
        <div class="row-drag-handle">⋮⋮</div>
        <input type="checkbox" ${m.active ? 'checked' : ''} onchange="modelRegistry.toggle(${i})">
        <span class="model-name-text">${m.name}</span>
        <button class="row-edit-btn" onclick="modelRegistry.openDetails(${i})">⋯</button>
      </div>
    `).join('');

    this.initDragAndDrop();
  }

  initDragAndDrop() {
    const rows = document.querySelectorAll('.model-row');
    rows.forEach(row => {
      row.addEventListener('dragstart', (e) => {
        this.draggedIndex = e.target.dataset.index;
        e.target.classList.add('dragging');
      });

      row.addEventListener('dragover', (e) => e.preventDefault());

      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const targetIndex = e.target.closest('.model-row').dataset.index;
        const movedItem = this.models.splice(this.draggedIndex, 1)[0];
        this.models.splice(targetIndex, 0, movedItem);
        this.render();
      });
    });
  }

  openDetails(index) {
    const m = this.models[index];
    const modal = document.getElementById('modelDetailModal');
    
    // Fill modal fields
    document.getElementById('detail-name').textContent = m.name;
    document.getElementById('detail-api').value = m.api;
    document.getElementById('detail-cat').value = m.category;
    
    modal.classList.remove('hidden');
    this.currentEditingIndex = index;
  }

  saveDetails() {
    const idx = this.currentEditingIndex;
    this.models[idx].api = document.getElementById('detail-api').value;
    this.models[idx].category = document.getElementById('detail-cat').value;
    document.getElementById('modelDetailModal').classList.add('hidden');
    this.render();
  }

  updateDropdowns() {
    const activeOnes = this.models.filter(m => m.active);
    const selects = ['map-primary', 'map-coding', 'map-research', 'map-image', 'map-vocal'];
    
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const current = el.value;
      el.innerHTML = activeOnes.map(m => 
        `<option value="${m.id}" ${m.id === current ? 'selected' : ''}>${m.name.split('/').pop()}</option>`
      ).join('');
    });
  }
}

window.modelRegistry = new ModelInventory();
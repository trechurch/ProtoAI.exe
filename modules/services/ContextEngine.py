# SDOA v1.2 compliant — Orchestration Service
from base import Service

class ContextEngine(Service):
    MANIFEST = {
        "id": "ContextEngine",
        "runtime": "Python",
        "version": "1.2.2",
        "dependencies": ["QmdAdapter"]
    }

    def get_refactor_context(self, feature_name: str):
        # Delegate retrieval to the QmdAdapter (Access Layer)
        qmd = self.registry.get("QmdAdapter")
        
        # Semantic search for logic and SQL query for raw snippets
        logic_map = qmd.search(f"logic related to {feature_name}")
        raw_snippets = qmd.query(f"SELECT path, content FROM snippets WHERE content LIKE '%{feature_name}%' LIMIT 5")
        
        return {
            "intent": feature_name,
            "logic": [res for res in logic_map if res['score'] > 0.75],
            "code": raw_snippets
        }
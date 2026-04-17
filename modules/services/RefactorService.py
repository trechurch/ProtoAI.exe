# SDOA v1.2 compliant — Logic Engine
from base import Service

class RefactorService(Service):
    MANIFEST = {
        "id": "RefactorService",
        "runtime": "Python",
        "version": "1.1.2",
        "dependencies": ["ContextEngine", "LlmBridge"]
    }

    def propose_refactor(self, target_module: str, goal: str):
        # 1. Acquire consolidated context from our Broker
        context = self.registry.get("ContextEngine").get_refactor_context(target_module)
        
        # 2. Build a high-signal prompt
        prompt = f"""
        Architectural Goal: {goal}
        Target Codebase: {context['code']}
        Related Patterns: {context['logic']}
        """
        
        # 3. Request generation through the Bridge (handles fail-over/credits)
        return self.registry.get("LlmBridge").generate(
            prompt=prompt,
            systemPrompt="You are a Senior SDOA Architect. Propose precise refactors.",
            tier="high_reasoning"
        )
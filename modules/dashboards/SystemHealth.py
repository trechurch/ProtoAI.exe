# SDOA v1.2 compliant — Streamlit Dashboard
from base import Dashboard
import streamlit as st

class SystemHealth(Dashboard):
    MANIFEST = {
        "id": "SystemHealth",
        "runtime": "Python",
        "version": "1.2.0",  
        "dependencies": [
            "ProvisioningService", 
            "BunInstaller", 
            "LlmPolicyEngine"
        ]
    }

    def render(self):
        st.title("🛡️ SDOA Control Plane")
        
        # Sync with the Registry state
        policy = self.registry.get("LlmPolicyEngine").getPolicy()
        
        col1, col2 = st.columns(2)
        with col1:
            st.metric("Primary LLM", policy['primary']['provider'].upper())
            if st.button("Force Economic Fail-over"):
                self.registry.get("LlmPolicyEngine").updatePolicy({"primary": {"provider": "ollama"}})
                st.rerun()

        with col2:
            status = "Healthy" if self.registry.get("ProvisioningService").verify_environment() else "Broken"
            st.metric("Runtime Status", status) 
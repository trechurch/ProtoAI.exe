# SDOA v1.2 compliant — Control Dashboard
from base import Dashboard
import streamlit as st

class LlmSettings(Dashboard):
    MANIFEST = {"id": "LlmSettings", "runtime": "Python", "dependencies": ["LlmPolicyEngine"]}

    def render(self):
        st.title("🛡️ LLM Governance Portal")
        policy_engine = self.registry.get("LlmPolicyEngine")
        current = policy_engine.getPolicy()

        st.subheader("Current Configuration")
        st.json(current)

        with st.form("update_policy"):
            new_primary = st.selectbox("Set Primary Provider", ["anthropic", "openai", "ollama"])
            new_model = st.text_input("Model ID", value=current['primary']['model'])
            
            if st.form_submit_button("Apply Fail-over Policy"):
                policy_engine.updatePolicy({
                    "primary": {"provider": new_primary, "model": new_model}
                })
                st.success("Policy updated across all SDOA modules.")
                st.rerun()
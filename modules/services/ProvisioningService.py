# SDOA v1.2 compliant — System Setup Service
from base import Service

class ProvisioningService(Service):
    MANIFEST = {
        "id": "ProvisioningService",
        "runtime": "Python",
        "version": "1.0.3",
        "dependencies": ["BunInstaller"]
    }

    def verify_environment(self):
        installer = self.registry.get("BunInstaller")
        
        if not installer.isInstalled():
            self.bump_patch("Bun runtime missing. Requesting provisioning.")
            return installer.install() # Triggers the JS-based installer
            
        return True
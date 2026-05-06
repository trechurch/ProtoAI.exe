const memory = require("c:/protoai/tauri-app/src-tauri/resources/server/lib/MemoryManager");
const paths = require("c:/protoai/tauri-app/src-tauri/resources/server/access/env/paths");
const fs = require("fs-extra");

async function test() {
  console.log("Testing MemoryManager...");
  
  // 1. Record an observation
  await memory.record("user_observation", "User likes to write code in Rust and prefers a concise style.");
  console.log("Recorded observation.");

  // 2. Load profile
  const profile = memory.loadUserProfile();
  console.log("User Profile:", JSON.stringify(profile, null, 2));

  // 3. Verify file exists
  if (fs.existsSync(paths.userProfile())) {
    console.log("Success: user-profile.json exists.");
  } else {
    console.log("Error: user-profile.json not found.");
  }
}

test().catch(console.error);

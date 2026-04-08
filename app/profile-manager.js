const fs = require('fs');
const path = require('path');

let profilesDir = null;
let configPath = null;

function init(userDataDir) {
  profilesDir = path.join(userDataDir, 'profiles');
  configPath = path.join(profilesDir, '_config.json');
  if (!fs.existsSync(profilesDir)) {
    fs.mkdirSync(profilesDir, { recursive: true });
  }
}

function readConfig() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch {}
  return { activeProfileId: null };
}

function writeConfig(cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
}

function listProfiles() {
  if (!profilesDir) return [];
  try {
    const files = fs.readdirSync(profilesDir).filter(f => f.endsWith('.json') && f !== '_config.json');
    return files.map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(profilesDir, f), 'utf8'));
        return {
          id: data.id,
          name: data.name,
          createdAt: data.createdAt,
          preferredTranslation: data.preferredTranslation?.code || data.preferredTranslation || null,
          sermonCount: data.sermons?.length || 0,
        };
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function getProfile(id) {
  if (!profilesDir) return null;
  const filePath = path.join(profilesDir, `${id}.json`);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch {}
  return null;
}

function saveProfile(profile) {
  if (!profilesDir) return false;
  const filePath = path.join(profilesDir, `${profile.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2));
  return true;
}

function deleteProfile(id) {
  if (!profilesDir) return false;
  const filePath = path.join(profilesDir, `${id}.json`);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    // Clear active if we just deleted it.
    const cfg = readConfig();
    if (cfg.activeProfileId === id) {
      cfg.activeProfileId = null;
      writeConfig(cfg);
    }
    return true;
  } catch {
    return false;
  }
}

function getActiveProfileId() {
  return readConfig().activeProfileId || null;
}

function setActiveProfileId(id) {
  const cfg = readConfig();
  cfg.activeProfileId = id;
  writeConfig(cfg);
}

function getActiveProfilePath() {
  const id = getActiveProfileId();
  if (!id || !profilesDir) return '';
  const filePath = path.join(profilesDir, `${id}.json`);
  return fs.existsSync(filePath) ? filePath : '';
}

// Generate a URL-safe ID from a name.
function nameToId(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || `profile-${Date.now()}`;
}

module.exports = {
  init,
  listProfiles,
  getProfile,
  saveProfile,
  deleteProfile,
  getActiveProfileId,
  setActiveProfileId,
  getActiveProfilePath,
  nameToId,
};

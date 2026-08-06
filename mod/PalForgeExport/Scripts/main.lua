--[[
  PalForge Palbox and dimensional storage export.

  Reads the Pals your client already holds in memory and writes them out as a cumulative
  PalForge roster file, so a player with no access to Level.sav can still plan from their
  real storage instead of typing it back in by hand.

  Read-only by construction. It looks up objects, formats text, and writes one JSON file.
  It never sets a property, calls a gameplay function, or talks to the server -- there is
  nothing here that changes what you own, and nothing a server would see.

  Output is PalForge's own roster format, so it goes straight into My Pals -> Import with
  no conversion step.
]]

local OUTPUT_FILE = 'PalForgeRoster.json'
local HOTKEY = Key.F8
local CLEAR_HOTKEY = Key.F9

-- Palworld stores IVs under names that do not match what the UI calls them. This is the
-- same mapping the save-file parser uses, and the two must not drift apart.
local IV_FIELDS = { hp = 'Talent_HP', attack = 'Talent_Shot', defense = 'Talent_Defense' }

-- Prefixes on CharacterID that mark a variant rather than a different species. An alpha
-- Anubis is still an Anubis for breeding, and PalForge's dataset is keyed on the bare name.
local VARIANT_PREFIXES = { 'BOSS_', 'PREDATOR_', 'SUMMON_' }

-- Gender reads as an EPalGenderType. Newer UE4SS hands back the enum name, while the
-- Palworld-compatible build returns the current raw values: None=0, Female=1, Male=2.
local GENDER_BY_VALUE = { [1] = 'Female', [2] = 'Male' }

local function newSession()
  return {
    pals = {},
    seen = {},
    owners = {},
    scanCount = 0,
    opaqueOwners = 0,
    fallbackKeys = 0,
  }
end

local SESSION = newSession()

local function resetSession()
  SESSION = newSession()
end

-- --- small helpers ----------------------------------------------------------------

--- FName, FString and plain Lua values all reach here; normalise them to a Lua string.
local function toStr(value)
  if value == nil then return '' end
  local kind = type(value)
  if kind == 'string' then return value end
  if kind == 'number' then return tostring(value) end
  local ok, text = pcall(function() return value:ToString() end)
  if ok and type(text) == 'string' then return text end
  return tostring(value)
end

--- `EPalGenderType::Female` -> `Female`. Enum values arrive qualified in some builds.
local function stripEnumPrefix(text)
  return text:match('::([^:]+)$') or text
end

--- Reads a property without letting a renamed field take the whole export down with it.
local function read(object, field)
  local ok, value = pcall(function() return object[field] end)
  if not ok then return nil end
  return value
end

local function saveParameter(param)
  return read(param, 'SaveParameter')
end

--- Numeric struct members are plain Lua numbers in some UE4SS builds and TrivialObject
--- wrappers in others. Unwrap the latter before comparing or formatting GUID components.
local function toNumber(value)
  if type(value) == 'number' then return value end
  if value == nil then return nil end
  local ok, inner = pcall(function() return value:get() end)
  if ok and inner ~= value then
    local converted, number = pcall(tonumber, inner)
    if converted and number ~= nil then return number end
  end
  -- Some UE4SS builds expose struct scalars as opaque TrivialObject references. Their
  -- address points at the scalar in game memory; UE4SS's guarded dereference helper is the
  -- only public way to read it without writing anything.
  if type(DerefToInt32) == 'function' then
    local gotAddress, address = pcall(function() return value:GetAddress() end)
    if gotAddress and type(address) == 'number' then
      local dereferenced, number = pcall(DerefToInt32, address)
      if dereferenced and type(number) == 'number' then return number end
    end
  end
  return tonumber(toStr(value))
end

local function guidPart(object, field)
  -- Keep each component to eight hex digits if UE exposes its uint32 as a signed integer.
  return (toNumber(read(object, field)) or 0) % 0x100000000
end

local function guidString(value)
  if value == nil then return '' end

  -- FGuid itself still exposes ToString even on UE4SS builds that return its individual
  -- uint32 fields as opaque TrivialObject references. Prefer that public representation.
  local text = toStr(value)
  local compact = text:gsub('[{}%-]', '')
  if #compact == 32 and compact:match('^%x+$') then
    compact = compact:upper()
    if compact ~= string.rep('0', 32) then return compact end
    return ''
  end

  -- Older builds expose A-D as ordinary numbers, so retain that path as a fallback.
  local a, b, c, d = guidPart(value, 'A'), guidPart(value, 'B'),
                     guidPart(value, 'C'), guidPart(value, 'D')
  if a == 0 and b == 0 and c == 0 and d == 0 then return '' end
  return string.format('%08X%08X%08X%08X', a, b, c, d)
end

local JSON_ESCAPES = { ['"'] = '\\"', ['\\'] = '\\\\', ['\b'] = '\\b', ['\f'] = '\\f',
                       ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }

local function jsonString(text)
  local escaped = text:gsub('[%c"\\]', function(char)
    return JSON_ESCAPES[char] or string.format('\\u%04x', char:byte())
  end)
  return '"' .. escaped .. '"'
end

-- --- reading one Pal --------------------------------------------------------------

local function readSpecies(param)
  local id = toStr(read(saveParameter(param), 'CharacterID'))
  if id == '' then return '', '' end
  local species = id
  for _, prefix in ipairs(VARIANT_PREFIXES) do
    if species:upper():sub(1, #prefix) == prefix then
      species = species:sub(#prefix + 1)
    end
  end
  return species, id
end

local function readGender(param)
  local raw = read(saveParameter(param), 'Gender')
  if raw == nil then return 'Unknown' end
  local text = stripEnumPrefix(toStr(raw)):lower()
  -- Female first: it contains "male", so the looser test has to lose.
  if text:find('female') then return 'Female' end
  if text:find('male') then return 'Male' end
  return GENDER_BY_VALUE[tonumber(text)] or 'Unknown'
end

local function readPassives(param)
  local passives = {}
  local list = read(saveParameter(param), 'PassiveSkillList')
  if list == nil then return passives end
  pcall(function()
    list:ForEach(function(_, element)
      local name = stripEnumPrefix(toStr(element:get()))
      if name ~= '' and name:lower() ~= 'none' then
        passives[#passives + 1] = name
      end
    end)
  end)
  return passives
end

local function readIvs(param)
  local ivs = {}
  local saved = saveParameter(param)
  for key, field in pairs(IV_FIELDS) do
    ivs[key] = toNumber(read(saved, field)) or 0
  end
  return ivs
end

local function readNickname(param)
  return toStr(read(saveParameter(param), 'NickName'))
end

--- The owning player's id, or "" for a wild Pal.
---
--- This is the ownership filter when UE4SS makes the GUID value readable. A compatibility
--- fallback below handles builds that expose only an opaque reference to that value.
local function ownerId(param)
  local value = read(saveParameter(param), 'OwnerPlayerUId')
  local id = guidString(value)
  if id ~= '' then return id, false end

  -- Certain UE4SS builds expose every FGuid only as an opaque TrivialObject and do not
  -- provide the memory dereference helper. The address proves the property exists but not
  -- whether its value is zero. Accept the loaded candidate in that compatibility mode and
  -- make the reduced certainty explicit in the export summary.
  if toStr(value):match('^TrivialObject:') and type(DerefToInt32) ~= 'function' then
    return '<owner unavailable>', true
  end
  return '', false
end

--- Identity, so a Pal held by more than one live object is not exported twice.
local function instanceKey(param, pal, owner)
  local individual = read(param, 'IndividualId')
  if individual ~= nil then
    local instance = read(individual, 'InstanceId')
    if instance ~= nil then
      local id = guidString(instance)
      if id ~= '' then return id, true end
      local opaque = toStr(instance)
      if opaque:match('^TrivialObject:') then return 'opaque-instance|' .. opaque, false end
    end
  end
  -- No usable instance id: fall back to something stable enough to spot a duplicate.
  return table.concat({
    pal.species,
    owner,
    pal.gender,
    pal.nickname,
    table.concat(pal.passives, '+'),
    tostring(pal.ivs.hp),
    tostring(pal.ivs.attack),
    tostring(pal.ivs.defense),
    toStr(read(saveParameter(param), 'Level')),
  }, '|'), false
end

-- --- export -----------------------------------------------------------------------

local function palToJson(pal)
  local passives = {}
  for i, name in ipairs(pal.passives) do passives[i] = jsonString(name) end
  return table.concat({
    '    { "species": ', jsonString(pal.species),
    ', "gender": ', jsonString(pal.gender),
    ', "passives": [', table.concat(passives, ', '), ']',
    ', "ivs": { "hp": ', pal.ivs.hp, ', "attack": ', pal.ivs.attack,
    ', "defense": ', pal.ivs.defense, ' }',
    pal.nickname ~= '' and (', "nickname": ' .. jsonString(pal.nickname)) or '',
    ' }',
  })
end

local function scanLoadedPals()
  local params = FindAllOf('PalIndividualCharacterParameter')
  local stats = {
    loaded = params ~= nil and #params or 0,
    added = 0,
    duplicates = 0,
    wild = 0,
    opaqueOwners = 0,
    opaqueSpecies = 0,
    fallbackKeys = 0,
    ownerSample = nil,
    addedPals = {},
    newRecords = {},
    newSeen = {},
  }

  if params == nil or #params == 0 then return stats end

  for _, param in ipairs(params) do
    local species, rawId = readSpecies(param)
    if rawId:match('^TrivialObject:') then stats.opaqueSpecies = stats.opaqueSpecies + 1 end
    -- Humans share this parameter type; they are not breedable and not wanted here.
    if species ~= '' and not rawId:match('^TrivialObject:') and not rawId:find('Player') then
      local owner, ownerOpaque = ownerId(param)
      if owner == '' then
        if stats.ownerSample == nil then
          stats.ownerSample = toStr(read(saveParameter(param), 'OwnerPlayerUId'))
        end
        stats.wild = stats.wild + 1
      else
        if ownerOpaque then stats.opaqueOwners = stats.opaqueOwners + 1 end
        local pal = {
          species = species,
          gender = readGender(param),
          passives = readPassives(param),
          ivs = readIvs(param),
          nickname = readNickname(param),
        }
        local key, reliableKey = instanceKey(param, pal, owner)
        if not SESSION.seen[key] and not stats.newSeen[key] then
          stats.newSeen[key] = true
          stats.added = stats.added + 1
          stats.addedPals[#stats.addedPals + 1] = pal
          stats.newRecords[#stats.newRecords + 1] = {
            key = key,
            owner = owner,
            pal = pal,
            ownerOpaque = ownerOpaque,
            reliableKey = reliableKey,
          }
          if not reliableKey then stats.fallbackKeys = stats.fallbackKeys + 1 end
        else
          stats.duplicates = stats.duplicates + 1
        end
      end
    end
  end
  return stats
end

local function commitScan(stats)
  for _, record in ipairs(stats.newRecords) do
    SESSION.seen[record.key] = true
    SESSION.owners[record.owner] = (SESSION.owners[record.owner] or 0) + 1
    SESSION.pals[#SESSION.pals + 1] = record.pal
    if record.ownerOpaque then SESSION.opaqueOwners = SESSION.opaqueOwners + 1 end
    if not record.reliableKey then SESSION.fallbackKeys = SESSION.fallbackKeys + 1 end
  end
  SESSION.scanCount = SESSION.scanCount + 1
end

local function writeRoster()
  local entries = {}
  for i, pal in ipairs(SESSION.pals) do entries[i] = palToJson(pal) end

  local file, err = io.open(OUTPUT_FILE, 'w')
  if not file then
    print('[PalForge] Could not write ' .. OUTPUT_FILE .. ': ' .. tostring(err) .. '\n')
    return false
  end
  file:write('{\n  "format": "palforge-roster",\n  "version": 1,\n')
  file:write('  "exportMode": "cumulative-loaded-pages",\n')
  file:write('  "scans": ', SESSION.scanCount, ',\n')
  file:write('  "pals": [\n')
  file:write(table.concat(entries, ',\n'))
  file:write('\n  ]\n}\n')
  file:close()
  return true
end

local function exportRoster()
  local stats = scanLoadedPals()

  if stats.loaded == 0 then
    print('[PalForge] Found no Pal data. Open your Palbox or dimensional storage once, then press F8 again.\n')
    return
  end

  if stats.opaqueSpecies > 0 then
    print(string.format(
      '[PalForge] Export unavailable: UE4SS returned opaque values for CharacterID on %d/%d objects.\n',
      stats.opaqueSpecies, stats.loaded))
    print('[PalForge] This UE4SS build cannot expose species, gender, passives or IVs; no roster was written.\n')
    return
  end

  commitScan(stats)

  if #SESSION.pals == 0 then
    print(string.format(
      '[PalForge] Saw %d Pal objects but none owned by a player (%d wild). Open your Palbox or dimensional storage, then retry.\n',
      stats.loaded, stats.wild))
    print('[PalForge] OwnerPlayerUId sample: ' .. tostring(stats.ownerSample) .. '\n')
    print('[PalForge] DerefToInt32 available: ' ..
          tostring(type(DerefToInt32) == 'function') .. '\n')
    return
  end

  if not writeRoster() then return end

  -- Echoed so the export can be checked against the Palbox on screen without opening the
  -- file. A wrong gender mapping is obvious here and nowhere else.
  print(string.format(
    '[PalForge] Scan %d saw %d loaded Pal objects: %d new, %d already seen, %d wild ignored.\n',
    SESSION.scanCount, stats.loaded, stats.added, stats.duplicates, stats.wild))
  print(string.format('[PalForge] Wrote %d cumulative Pals to %s.\n',
                      #SESSION.pals, OUTPUT_FILE))
  if SESSION.opaqueOwners > 0 then
    print(string.format(
      '[PalForge] Warning: ownership GUIDs were opaque for %d exported candidates. Nearby wild Pals may be included.\n',
      SESSION.opaqueOwners))
  end
  if SESSION.fallbackKeys > 0 then
    print(string.format(
      '[PalForge] Note: %d exported Pals had no readable instance id; duplicate detection used fallback keys.\n',
      SESSION.fallbackKeys))
  end
  if stats.added == 0 then
    print('[PalForge] No new Pals were added from this loaded page.\n')
  end
  for _, pal in ipairs(stats.addedPals) do
    print(string.format('[PalForge]   + %s %s %s\n', pal.species, pal.gender,
                        #pal.passives > 0 and table.concat(pal.passives, ', ') or '-'))
  end
  print('[PalForge] Flip to the next Palbox or dimensional-storage page after it loads, then press F8 again. Press F9 to clear this session.\n')

  local distinct = 0
  for _ in pairs(SESSION.owners) do distinct = distinct + 1 end
  if distinct > 1 then
    print('[PalForge] Note: Pals from more than one owner were present; check the list.\n')
  end
end

RegisterKeyBind(HOTKEY, function()
  local ok, err = pcall(exportRoster)
  if not ok then
    print('[PalForge] Export failed: ' .. tostring(err) .. '\n')
  end
end)

RegisterKeyBind(CLEAR_HOTKEY, function()
  resetSession()
  print('[PalForge] Cleared the cumulative roster cache. Press F8 to scan the current loaded storage page.\n')
end)

print('[PalForge] Palbox export loaded (cumulative property-only build). Open your Palbox or dimensional storage, press F8 per loaded page, F9 to clear.\n')

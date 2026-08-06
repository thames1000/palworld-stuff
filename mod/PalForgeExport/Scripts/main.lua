--[[
  PalForge Palbox export.

  Reads the Pals your client already holds in memory and writes them out as a PalForge
  roster file, so a player with no access to Level.sav can still plan from their real
  Palbox instead of typing it back in by hand.

  Read-only by construction. It looks up objects, formats text, and writes one JSON file.
  It never sets a property, calls a gameplay function, or talks to the server -- there is
  nothing here that changes what you own, and nothing a server would see.

  Output is PalForge's own roster format, so it goes straight into My Pals -> Import with
  no conversion step.
]]

local OUTPUT_FILE = 'PalForgeRoster.json'
local HOTKEY = Key.F8

-- Palworld stores IVs under names that do not match what the UI calls them. This is the
-- same mapping the save-file parser uses, and the two must not drift apart.
local IV_FIELDS = { hp = 'Talent_HP', attack = 'Talent_Shot', defense = 'Talent_Defense' }

-- Prefixes on CharacterID that mark a variant rather than a different species. An alpha
-- Anubis is still an Anubis for breeding, and PalForge's dataset is keyed on the bare name.
local VARIANT_PREFIXES = { 'BOSS_', 'PREDATOR_', 'SUMMON_' }

-- Gender reads as an EPalGenderType. Newer UE4SS hands back the enum name, older builds
-- hand back the raw integer, so both are handled; these are the fallback for the integer
-- case. If every Pal comes out the wrong sex, swap these two -- nothing else needs changing.
local GENDER_BY_VALUE = { [0] = 'Male', [1] = 'Female' }

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
    ivs[key] = tonumber(toStr(read(saved, field))) or 0
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
local function instanceKey(param, species, owner)
  local individual = read(param, 'IndividualId')
  if individual ~= nil then
    local instance = read(individual, 'InstanceId')
    if instance ~= nil then
      local id = guidString(instance)
      if id ~= '' then return id end
      local opaque = toStr(instance)
      if opaque:match('^TrivialObject:') then return opaque end
    end
  end
  -- No usable instance id: fall back to something stable enough to spot a duplicate.
  return table.concat({ species, owner, readNickname(param),
                        toStr(read(saveParameter(param), 'Level')) }, '|')
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

local function exportRoster()
  local params = FindAllOf('PalIndividualCharacterParameter')
  if params == nil or #params == 0 then
    print('[PalForge] Found no Pal data. Open your Palbox once, then press the key again.\n')
    return
  end

  local pals, seen, owners, wild, opaqueOwners, opaqueSpecies, ownerSample =
    {}, {}, {}, 0, 0, 0, nil

  for _, param in ipairs(params) do
    local species, rawId = readSpecies(param)
    if rawId:match('^TrivialObject:') then opaqueSpecies = opaqueSpecies + 1 end
    -- Humans share this parameter type; they are not breedable and not wanted here.
    if species ~= '' and not rawId:match('^TrivialObject:') and not rawId:find('Player') then
      local owner, ownerOpaque = ownerId(param)
      if owner == '' then
        if ownerSample == nil then
          ownerSample = toStr(read(saveParameter(param), 'OwnerPlayerUId'))
        end
        wild = wild + 1
      else
        if ownerOpaque then opaqueOwners = opaqueOwners + 1 end
        local key = instanceKey(param, species, owner)
        if not seen[key] then
          seen[key] = true
          owners[owner] = (owners[owner] or 0) + 1
          pals[#pals + 1] = {
            species = species,
            gender = readGender(param),
            passives = readPassives(param),
            ivs = readIvs(param),
            nickname = readNickname(param),
          }
        end
      end
    end
  end

  if opaqueSpecies > 0 then
    print(string.format(
      '[PalForge] Export unavailable: UE4SS returned opaque values for CharacterID on %d/%d objects.\n',
      opaqueSpecies, #params))
    print('[PalForge] This UE4SS build cannot expose species, gender, passives or IVs; no roster was written.\n')
    return
  end

  if #pals == 0 then
    print(string.format(
      '[PalForge] Saw %d Pal objects but none owned by a player (%d wild). Open your Palbox, then retry.\n',
      #params, wild))
    print('[PalForge] OwnerPlayerUId sample: ' .. tostring(ownerSample) .. '\n')
    print('[PalForge] DerefToInt32 available: ' ..
          tostring(type(DerefToInt32) == 'function') .. '\n')
    return
  end

  local entries = {}
  for i, pal in ipairs(pals) do entries[i] = palToJson(pal) end

  local file, err = io.open(OUTPUT_FILE, 'w')
  if not file then
    print('[PalForge] Could not write ' .. OUTPUT_FILE .. ': ' .. tostring(err) .. '\n')
    return
  end
  file:write('{\n  "format": "palforge-roster",\n  "version": 1,\n  "pals": [\n')
  file:write(table.concat(entries, ',\n'))
  file:write('\n  ]\n}\n')
  file:close()

  -- Echoed so the export can be checked against the Palbox on screen without opening the
  -- file. A wrong gender mapping is obvious here and nowhere else.
  print(string.format('[PalForge] Wrote %d Pals to %s (%d wild ignored)\n',
                      #pals, OUTPUT_FILE, wild))
  if opaqueOwners > 0 then
    print(string.format(
      '[PalForge] Warning: ownership GUIDs were opaque; exported %d loaded candidates. Nearby wild Pals may be included.\n',
      opaqueOwners))
  end
  for _, pal in ipairs(pals) do
    print(string.format('[PalForge]   %s %s %s\n', pal.species, pal.gender,
                        #pal.passives > 0 and table.concat(pal.passives, ', ') or '-'))
  end

  local distinct = 0
  for _ in pairs(owners) do distinct = distinct + 1 end
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

print('[PalForge] Palbox export loaded (property-only build). Open your Palbox, then press F8.\n')

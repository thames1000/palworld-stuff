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
  local id = toStr(read(param, 'CharacterID'))
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
  local raw = read(param, 'Gender')
  if raw == nil then return 'Unknown' end
  local text = stripEnumPrefix(toStr(raw)):lower()
  -- Female first: it contains "male", so the looser test has to lose.
  if text:find('female') then return 'Female' end
  if text:find('male') then return 'Male' end
  return GENDER_BY_VALUE[tonumber(text)] or 'Unknown'
end

local function readPassives(param)
  local passives = {}
  local list = read(param, 'PassiveSkillList')
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
  for key, field in pairs(IV_FIELDS) do
    ivs[key] = tonumber(toStr(read(param, field))) or 0
  end
  return ivs
end

--- The owning player's id, or "" for a wild Pal.
---
--- This is the whole ownership filter. Your client holds parameters for wild Pals rendered
--- around you as well as your own, and telling them apart by *your* player id would mean
--- finding it first -- one more version-specific lookup to get wrong. A wild Pal simply has
--- no owner, and another player's Palbox is never replicated to you, so "has an owner at
--- all" is both simpler and sufficient.
local function ownerId(param)
  local uid = read(param, 'OwnerPlayerUId')
  if uid == nil then return '' end
  local a, b, c, d = read(uid, 'A') or 0, read(uid, 'B') or 0, read(uid, 'C') or 0, read(uid, 'D') or 0
  if a == 0 and b == 0 and c == 0 and d == 0 then return '' end
  return string.format('%08X%08X%08X%08X', a, b, c, d)
end

--- Identity, so a Pal held by more than one live object is not exported twice.
local function instanceKey(param, species, owner)
  local individual = read(param, 'IndividualId')
  if individual ~= nil then
    local instance = read(individual, 'InstanceId')
    if instance ~= nil then
      local a, b, c, d = read(instance, 'A') or 0, read(instance, 'B') or 0,
                         read(instance, 'C') or 0, read(instance, 'D') or 0
      if a ~= 0 or b ~= 0 or c ~= 0 or d ~= 0 then
        return string.format('%08X%08X%08X%08X', a, b, c, d)
      end
    end
  end
  -- No usable instance id: fall back to something stable enough to spot a duplicate.
  return table.concat({ species, owner, toStr(read(param, 'NickName')),
                        toStr(read(param, 'Level')) }, '|')
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

  local pals, seen, owners, wild = {}, {}, {}, 0

  for _, param in ipairs(params) do
    local species, rawId = readSpecies(param)
    -- Humans share this parameter type; they are not breedable and not wanted here.
    if species ~= '' and not rawId:find('Player') then
      local owner = ownerId(param)
      if owner == '' then
        wild = wild + 1
      else
        local key = instanceKey(param, species, owner)
        if not seen[key] then
          seen[key] = true
          owners[owner] = (owners[owner] or 0) + 1
          pals[#pals + 1] = {
            species = species,
            gender = readGender(param),
            passives = readPassives(param),
            ivs = readIvs(param),
            nickname = toStr(read(param, 'NickName')),
          }
        end
      end
    end
  end

  if #pals == 0 then
    print(string.format(
      '[PalForge] Saw %d Pal objects but none owned by a player (%d wild). Open your Palbox, then retry.\n',
      #params, wild))
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

print('[PalForge] Palbox export loaded. Open your Palbox, then press F8.\n')

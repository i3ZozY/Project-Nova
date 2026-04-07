-- backend/main.lua
local logger = millennium.logger

-- This function will be called from your frontend JavaScript
function run_manifest_updater(args)
    logger:info("RunManifestUpdater called from frontend")

    -- Build the full path to manifests.ps1 (located in plugin root)
    local script_path = millennium.plugin_path() .. "/manifests.ps1"

    -- Check if the script exists
    local file = io.open(script_path, "r")
    if not file then
        logger:error("Manifest script not found at: " .. script_path)
        return {
            success = false,
            error = "Manifest script not found. Please ensure 'manifests.ps1' is in your plugin's root folder."
        }
    end
    file:close()

    -- Execute PowerShell and capture output
    -- The command: powershell.exe -ExecutionPolicy Bypass -File "path\to\manifests.ps1"
    local command = string.format('powershell.exe -ExecutionPolicy Bypass -File "%s"', script_path)
    logger:info("Executing: " .. command)

    local handle = io.popen(command)
    local output = handle:read("*a")
    local success = handle:close()

    if success then
        logger:info("Manifest updater finished successfully")
        return {
            success = true,
            output = output
        }
    else
        logger:error("Manifest updater failed")
        return {
            success = false,
            error = "PowerShell script execution failed. See output for details.",
            output = output
        }
    end
end

-- Your existing on_load, on_unload, etc. go here
function on_load()
    logger:info("Project Nova backend loaded")
end

function on_unload()
    logger:info("Project Nova backend unloaded")
end

function on_frontend_loaded()
    logger:info("Frontend loaded, backend ready")
end

-- Register all callable functions
return {
    on_load = on_load,
    on_unload = on_unload,
    on_frontend_loaded = on_frontend_loaded,
    run_manifest_updater = run_manifest_updater   -- <-- ADD THIS LINE
}
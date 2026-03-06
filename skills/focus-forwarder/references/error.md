# Install Error Handling

If the install command fails, read the error output carefully. Common causes and fixes:

- Permission or access error (`EACCES`): re-run the command with appropriate user-level permissions for the current OS.
- npm spawn error (`ENOENT`, `spawn npm`): verify that Node.js (v18+) and npm are installed and available in PATH. On Windows, confirm `where.exe npm` returns a valid path.
- File conflict (`EEXIST`): re-run the install command with `--force`.
- Network or registry error: check internet connectivity and retry.

After applying the fix, re-run the install command.

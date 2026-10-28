# Learning library

Put the PDF books for the **Learning** tab in this folder. Every signed-in user sees them (read-only) and can read
them in the app. Each user's page position is remembered separately.

- The API loads the folder into the database when it starts. A new file is added, and a file with the same name but
  different content is updated.
- Books are listed by file name, and the title is the file name without `.pdf`, with `_` shown as a space.
  A number at the start only sets the order and is not shown: `01 - Trading_Psychology.pdf` appears as
  "Trading Psychology".
- Files must be real PDFs, at most 100 MB each.
- Removing a file here does **not** delete the book (so a deploy that is missing the files can never empty the
  library). To remove books that are no longer in this folder, run `python -m app.library --prune` from `backend`.
- To load the folder without restarting, run `python -m app.library` from `backend`.
- Render deploys from git, so **commit the PDFs** for the live site to have them. GitHub refuses single files over
  100 MB, so use smaller files or Git LFS for big scans.

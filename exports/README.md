# Project inputs for manual rendering

Download project JSON from **Backup → Download project** and upload it here as
`project.json` (or choose another repository-relative path in the workflow).
No user project is included by default.

Run **Actions → Render project → Run workflow** in your own repository.
Choose `video` for MP4 or `cards` for transparent PNGs in a ZIP. Card players are
one-based roster slots, not shirt numbers. `small,big,key` exports all three types.
Download the artifact from the finished workflow run; retention is three days.

Project JSON embeds photos and custom fonts. Uploading it makes those assets part
of the repository and its history. Use a private repository for private assets.
Deleting a file in a later commit does not remove its history. Background videos
are not in project JSON: upload the video separately and set `background_video`
to its path, or choose another background before downloading the project.

This is a manually triggered workflow for repository owners, not a public export
API. No GitHub token is stored in the web app. Actions quotas and retention limits
depend on your GitHub plan. Local and browser exports remain available without it.

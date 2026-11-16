# File uploads for Contents (Cloudflare R2)

Agreed Nov 16, 2026. Officers who can manage contents may attach an uploaded file to a content item, as an
alternative to a link. **Links stay exactly as they are**: a content item is either a link (Drive, YouTube,
any website) or an uploaded file, and every existing link item keeps working unchanged.

## Limits

- File types: PDF, images (JPG, PNG, WebP, GIF), Word, PowerPoint, Excel (.doc/.docx, .ppt/.pptx, .xls/.xlsx).
- 10 MB per file, checked in the app before uploading and again by the server.
- 1 GB per class in total. The upload screen shows how much is used.
- Only roles with "Manage contents" upload or delete; every member of the class can open the files.
- Videos stay as links (Drive or YouTube).

## Pieces

1. **Files Worker** (`files/`, a new Cloudflare Worker next to `sender/`, with an R2 bucket `classhub-files`):
   - Checks the caller's Firebase sign-in (ID token signature against Google's public keys), then reads their
     membership and role from Firestore with their own token, so the security rules decide.
   - `POST /classes/{classId}/files`: upload (type, 10 MB and the 1 GB class total checked), returns the key.
   - `GET /classes/{classId}/files/{key}`: download for class members.
   - `DELETE /classes/{classId}/files/{key}`: for "Manage contents" roles.
   - `GET /classes/{classId}/usage`: bytes used of 1 GB.
   - Daily clean-up: removes files whose content item no longer exists, and all files of a deleted class.
   - Files are private: nothing in the bucket is public.
2. **Data and rules**: a content item may carry `file: { key, name, sizeBytes, mimeType }` instead of a link.
   Rules check the shape; tests added.
3. **Screens**:
   - Add or edit content: "Link" or "Upload file" choice, file picker, size and type check, progress, usage.
   - Content page: PDFs open inside ClassHub (pdf.js, loaded only when a PDF is opened); images show inline;
     Word, PowerPoint and Excel files open in the phone's own app (Android app) or download (website).
   - A file opened once is kept on the device, so it opens offline afterwards.
   - Deleting a content item deletes its file.
4. **Local testing**: `wrangler dev` with a local R2 and the Firebase emulator (emulator sign-ins accepted
   only in dev mode). Never test against the live site.

## Order

1. Files Worker with local tests.
2. Data model, rules and rules tests.
3. Screens, PDF viewer, offline copy.
4. Clean-up job.
5. The user: turns on R2 in the Cloudflare dashboard (asks for a payment method), creates bucket
   `classhub-files`. Then deploy: Worker, rules, hosting.

## Needs from the user

- Done: pdfjs-dist 6.5.438 installed by the user.
- R2 turned on and the bucket created (step 5).

## Status

- [x] 1 Worker (files/src/worker.js; files/test.mjs: 18 pass against the emulators)
- [x] 2 Data and rules (ContentItem.file, isContentFile in rules; 252 rules tests pass)
- [x] 3 Screens (form, row, FileViewer, PdfPages with the pdf.js legacy build for older phones, data/files.ts); checked on the emulator build incl. offline; unit 140, e2e 25
- [x] 4 Clean-up (in the Worker's daily cron; tested)
- [x] 5 Deploy (Nov 16): Worker classhub-files on workers.dev (address in web/.env.production, kept out of git),
      bucket classhub-files, SERVICE_ACCOUNT secret set, rules and hosting deployed. Live checks: no or forged
      sign-in refused (401), other sites refused, clean-up route absent. First real upload still to be tried.

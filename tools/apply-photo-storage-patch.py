#!/usr/bin/env python3
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def replace_once(rel, old, new):
    path = ROOT / rel
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected text not found in {rel}; stopping without guessing.\n--- expected ---\n{old[:500]}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


# ---- Browser app: initialize Storage and persist prepared report photos ----
replace_once(
    "maintenance/app.js",
    """import {\n  initializeAppCheck,\n  ReCaptchaV3Provider,\n  getToken as getAppCheckToken\n} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app-check.js';\n\nconst STAFF_EMAILS""",
    """import {\n  initializeAppCheck,\n  ReCaptchaV3Provider,\n  getToken as getAppCheckToken\n} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app-check.js';\nimport {\n  getStorage,\n  ref as storageRef,\n  uploadBytes,\n  deleteObject\n} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js';\n\nconst STAFF_EMAILS""",
)

replace_once(
    "maintenance/app.js",
    "let fs = null;\nlet currentUser = null;",
    "let fs = null;\nlet storage = null;\nlet currentUser = null;",
)

replace_once(
    "maintenance/app.js",
    "  auth = getAuth(app);\n  fs = getFirestore(app);\n\n  onAuthStateChanged",
    "  auth = getAuth(app);\n  fs = getFirestore(app);\n  storage = getStorage(app);\n\n  onAuthStateChanged",
)

replace_once(
    "maintenance/app.js",
    "const MAX_REPORT_PHOTOS = 3;\nconst MAX_REPORT_PHOTO_DIMENSION = 1600;\nconst REPORT_PHOTO_QUALITY = 0.78;",
    "const MAX_REPORT_PHOTOS = 3;\nconst MAX_REPORT_PHOTO_DIMENSION = 1600;\nconst REPORT_PHOTO_QUALITY = 0.78;\nconst MAX_REPORT_PHOTO_BYTES = 1572864; // 1.5 MiB per compressed JPEG",
)

replace_once(
    "maintenance/app.js",
    """  return {\n    blob,\n    filename: `maintenance-photo-${index + 1}.jpg`,""",
    """  if (blob.size > MAX_REPORT_PHOTO_BYTES) {\n    throw new Error('A prepared photo is still too large. Try a lower-resolution photo.');\n  }\n\n  return {\n    blob,\n    filename: `maintenance-photo-${index + 1}.jpg`,""",
)

replace_once(
    "maintenance/app.js",
    "$('#reportPhotos')?.addEventListener('change', async event => {",
    """async function deleteUploadedReportPhotos(paths = []) {\n  if (!storage) return;\n  await Promise.allSettled(\n    paths.map(path => deleteObject(storageRef(storage, path)))\n  );\n}\n\nasync function uploadReportPhotos(reportRef) {\n  if (!reportPhotoAttachments.length) return [];\n  if (!storage || !currentUser) {\n    throw new Error('Photo storage is not ready.');\n  }\n\n  const uploadedPaths = [];\n\n  try {\n    for (let index = 0; index < reportPhotoAttachments.length; index += 1) {\n      const photo = reportPhotoAttachments[index];\n      const path = `reportPhotos/${currentUser.uid}/${reportRef.id}/${photo.filename}`;\n      const target = storageRef(storage, path);\n\n      await uploadBytes(target, photo.blob, {\n        contentType: 'image/jpeg',\n        customMetadata: {\n          reportId: reportRef.id,\n          submittedByUid: currentUser.uid\n        }\n      });\n\n      uploadedPaths.push(path);\n    }\n\n    return uploadedPaths;\n  } catch (error) {\n    await deleteUploadedReportPhotos(uploadedPaths);\n    throw error;\n  }\n}\n\n$('#reportPhotos')?.addEventListener('change', async event => {""",
)

replace_once(
    "maintenance/app.js",
    """    roomSnapshot: m.room || '',\n    submittedByUid: currentUser.uid,\n    submittedByEmail: currentUser.email || ''\n  };""",
    """    roomSnapshot: m.room || '',\n    submittedByUid: currentUser.uid,\n    submittedByEmail: currentUser.email || '',\n    photoCount: reportPhotoAttachments.length,\n    photoPaths: [],\n    notificationReady: reportPhotoAttachments.length === 0\n  };""",
)

replace_once(
    "maintenance/app.js",
    """    });\n\n    // Immediately reflect the successful public status change in the UI.""",
    """    });\n\n    let photoWarning = '';\n\n    if (payload.photoCount > 0) {\n      let uploadedPhotoPaths = [];\n\n      try {\n        uploadedPhotoPaths = await uploadReportPhotos(reportRef);\n        await updateDoc(reportRef, {\n          photoPaths: uploadedPhotoPaths,\n          notificationReady: true\n        });\n      } catch (photoError) {\n        console.error('[TAD Lab Manager] Report photo upload failed', photoError);\n        await deleteUploadedReportPhotos(uploadedPhotoPaths);\n\n        // Do not strand the maintenance report if a photo fails. Release the\n        // stakeholder notification without attachments and tell the reporter.\n        await updateDoc(reportRef, {\n          photoCount: 0,\n          photoPaths: [],\n          notificationReady: true\n        });\n        photoWarning = 'Report submitted, but the photo attachment could not be uploaded.';\n      }\n    }\n\n    // Immediately reflect the successful public status change in the UI.""",
)

replace_once(
    "maintenance/app.js",
    "    toast(`Report ${reportRef.id.slice(0, 8)} submitted`);",
    "    toast(photoWarning || `Report ${reportRef.id.slice(0, 8)} submitted`);",
)

# Cache-bust the production maintenance module.
replace_once(
    "maintenance/index.html",
    'src="app.js?v=20260819-10"',
    'src="app.js?v=20260819-11"',
)

# ---- Firestore: permit only the reporter's one-time photo metadata finalize ----
replace_once(
    "firestore.rules",
    """          'resource','status','machineNameSnapshot','roomSnapshot',\n          'submittedByUid','submittedByEmail'\n        ])""",
    """          'resource','status','machineNameSnapshot','roomSnapshot',\n          'submittedByUid','submittedByEmail','photoCount','photoPaths',\n          'notificationReady'\n        ])""",
)

replace_once(
    "firestore.rules",
    """        && request.resource.data.submittedByEmail is string\n        && request.resource.data.submittedByEmail.size() <= 320\n        && reportRateCountersValid();\n\n      allow read, update, delete: if staff();""",
    """        && request.resource.data.submittedByEmail is string\n        && request.resource.data.submittedByEmail.size() <= 320\n        && request.resource.data.photoCount is int\n        && request.resource.data.photoCount >= 0\n        && request.resource.data.photoCount <= 3\n        && request.resource.data.photoPaths is list\n        && request.resource.data.photoPaths.size() == 0\n        && request.resource.data.notificationReady is bool\n        && request.resource.data.notificationReady == (request.resource.data.photoCount == 0)\n        && reportRateCountersValid();\n\n      allow read, delete: if staff();\n\n      allow update: if staff() || (\n        signedIn()\n        && resource.data.submittedByUid == request.auth.uid\n        && resource.data.status == 'Open'\n        && resource.data.notificationReady == false\n        && request.resource.data.diff(resource.data).affectedKeys().hasOnly([\n          'photoCount','photoPaths','notificationReady'\n        ])\n        && request.resource.data.photoCount is int\n        && request.resource.data.photoCount >= 0\n        && request.resource.data.photoCount <= 3\n        && request.resource.data.photoPaths is list\n        && request.resource.data.photoPaths.size() == request.resource.data.photoCount\n        && request.resource.data.photoPaths.size() <= 3\n        && request.resource.data.notificationReady == true\n      );""",
)

# ---- Storage: private report photos, owner upload only after a rate-limited report exists ----
storage_rules = r'''rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    function signedIn() {
      return request.auth != null;
    }

    function staff() {
      return signedIn()
        && request.auth.token.email != null
        && request.auth.token.email_verified == true
        && request.auth.token.firebase.sign_in_provider == 'password'
        && request.auth.token.email in [
          'eric.carlson.2@bemidjistate.edu',
          'chase.cornell@bemidjistate.edu',
          'andrew.graham@bemidjistate.edu',
          'nick.lowery@bemidjistate.edu'
        ];
    }

    match /reportPhotos/{uid}/{reportId}/{fileName} {
      allow read: if staff();

      allow create: if signedIn()
        && request.auth.uid == uid
        && fileName.matches('maintenance-photo-[1-3]\\.jpg')
        && request.resource.contentType == 'image/jpeg'
        && request.resource.size > 0
        && request.resource.size <= 1572864
        && firestore.exists(/databases/(default)/documents/reports/$(reportId))
        && firestore.get(/databases/(default)/documents/reports/$(reportId)).data.submittedByUid == request.auth.uid
        && firestore.get(/databases/(default)/documents/reports/$(reportId)).data.notificationReady == false
        && firestore.get(/databases/(default)/documents/reports/$(reportId)).data.photoCount >= 1
        && firestore.get(/databases/(default)/documents/reports/$(reportId)).data.photoCount <= 3;

      allow delete: if signedIn() && (request.auth.uid == uid || staff());
      allow update: if false;
    }

    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
'''
(ROOT / "storage.rules").write_text(storage_rules, encoding="utf-8")

# Tell Firebase CLI which Storage rules file to deploy.
replace_once(
    "firebase.json",
    """  \"firestore\": {\n    \"rules\": \"firestore.rules\"\n  },\n  \"functions\":""",
    """  \"firestore\": {\n    \"rules\": \"firestore.rules\"\n  },\n  \"storage\": {\n    \"rules\": \"storage.rules\"\n  },\n  \"functions\":""",
)

# ---- Function: wait for photos, download privately, attach only to stakeholder mail ----
replace_once(
    "functions/index.js",
    """const { getFirestore, FieldValue } = require('firebase-admin/firestore');\nconst { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');""",
    """const { getFirestore, FieldValue } = require('firebase-admin/firestore');\nconst { getStorage } = require('firebase-admin/storage');\nconst { onDocumentWritten, onDocumentUpdated } = require('firebase-functions/v2/firestore');""",
)

replace_once(
    "functions/index.js",
    "async function sendGmail({ to, subject, text }) {",
    "async function sendGmail({ to, subject, text, attachments = [] }) {",
)

replace_once(
    "functions/index.js",
    """    subject: clean(subject, 240),\n    text: String(text ?? '').slice(0, 12000),\n  });\n}\n\nexports.notifyMachineStakeholders = onDocumentCreated({""",
    """    subject: clean(subject, 240),\n    text: String(text ?? '').slice(0, 12000),\n    attachments: Array.isArray(attachments) ? attachments : [],\n  });\n}\n\nconst STORAGE_BUCKET = 'tad-lab-manager.firebasestorage.app';\nconst MAX_EMAIL_PHOTO_BYTES = 1572864;\n\nasync function loadReportPhotoAttachments(report, reportId) {\n  const uid = clean(report?.submittedByUid, 180);\n  const expectedPrefix = `reportPhotos/${uid}/${reportId}/`;\n  const paths = Array.isArray(report?.photoPaths)\n    ? report.photoPaths\n        .map(value => clean(value, 500))\n        .filter(value => value.startsWith(expectedPrefix))\n        .slice(0, 3)\n    : [];\n\n  if (!uid || !paths.length) return [];\n\n  const bucket = getStorage().bucket(STORAGE_BUCKET);\n  const attachments = [];\n\n  for (const photoPath of paths) {\n    try {\n      const [buffer] = await bucket.file(photoPath).download();\n      if (!buffer?.length || buffer.length > MAX_EMAIL_PHOTO_BYTES) {\n        console.warn('Skipping invalid maintenance photo attachment', {\n          reportId,\n          photoPath,\n          bytes: buffer?.length || 0,\n        });\n        continue;\n      }\n\n      attachments.push({\n        filename: photoPath.split('/').pop() || 'maintenance-photo.jpg',\n        content: buffer,\n        contentType: 'image/jpeg',\n      });\n    } catch (error) {\n      console.warn('Could not load maintenance photo attachment', {\n        reportId,\n        photoPath,\n        error: clean(error?.message || error, 300),\n      });\n    }\n  }\n\n  return attachments;\n}\n\nexports.notifyMachineStakeholders = onDocumentWritten({""",
)

replace_once(
    "functions/index.js",
    """}, async (event) => {\n  const report = event.data?.data();\n  if (!report) return;\n\n  const recipients = emailList(MAILJET_STAKEHOLDER_EMAILS.value());""",
    """}, async (event) => {\n  const beforeSnap = event.data?.before;\n  const afterSnap = event.data?.after;\n  if (!afterSnap?.exists) return;\n\n  const report = afterSnap.data();\n  if (!report || report.notificationReady !== true) return;\n\n  // Send once when a new report is immediately ready (no photos), or when\n  // photo upload finalization changes notificationReady from false to true.\n  if (beforeSnap?.exists && beforeSnap.data()?.notificationReady === true) return;\n\n  const recipients = emailList(MAILJET_STAKEHOLDER_EMAILS.value());""",
)

replace_once(
    "functions/index.js",
    """  const contact = clean(report.contact, 320) || 'Not provided';\n\n  try {\n    await sendGmail({\n      to: recipients,""",
    """  const contact = clean(report.contact, 320) || 'Not provided';\n  const attachments = await loadReportPhotoAttachments(report, reportId);\n\n  try {\n    await sendGmail({\n      to: recipients,\n      attachments,""",
)

replace_once(
    "functions/index.js",
    """      status: 'sent',\n      provider: 'gmail',\n      sentAt: FieldValue.serverTimestamp(),""",
    """      status: 'sent',\n      provider: 'gmail',\n      attachmentCount: attachments.length,\n      sentAt: FieldValue.serverTimestamp(),""",
)

# Remove this helper from the working tree so the next commit contains only
# the actual production changes.
Path(__file__).unlink()

subprocess.run(["node", "--check", "functions/index.js"], cwd=ROOT, check=True)
subprocess.run(["node", "--check", "maintenance/app.js"], cwd=ROOT, check=True)
subprocess.run(["git", "diff", "--check"], cwd=ROOT, check=True)

print("PHOTO PATCH READY")
print("Modified: maintenance/app.js, maintenance/index.html, firestore.rules, storage.rules, firebase.json, functions/index.js")

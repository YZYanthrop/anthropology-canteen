Anthropology Canteen @PRODUCT_VERSION@ — Windows x64 portable edition

System requirement: 64-bit Windows 10 or newer.

1. Extract the complete ZIP. Do not run files from the ZIP preview.
2. Double-click "Anthropology Canteen.vbs". The local server starts without a
   console window and opens the app in your default browser.
3. Close every Anthropology Canteen browser tab to stop the background server
   after about eight seconds. If no page connects, it stops after 90 seconds.
4. If startup fails, double-click start-local.cmd and keep its window open to
   read the diagnostic message.

The package includes Node.js; no separate Node.js installation or account is
needed. Your subscriptions, cached records, saved states, translations, and
optional API settings are stored only in this extracted folder's data
directory. The original ZIP is blank. Do not share a copy that you have already
run if it contains a data directory.

Optional email reminders are configured in Settings. They use the current
Windows user's Task Scheduler and do not require this web page or a console to
stay open. Use an SMTP authorization code/app password, never an email master
password. Some Windows systems require one administrator launch when the task
is first registered or migrated after an update: close every Anthropology
Canteen page, wait about 10 seconds, then right-click start-local.cmd and choose
"Run as administrator" before enabling reminders again. Administrator rights
are used only for registration or migration. The registered task still runs as
the current user with Limited privileges, and ordinary daily app launches do
not require administrator rights.

Automatic reminders are active only after step 3 turns green and displays
"后台提醒已开启". Registration completes before the first baseline check, so a
registration failure cannot send a one-time message or leave reminders partly
enabled. The computer must be on, the user logged in, and online; missed runs
are retried after login. No email is sent when there are no new articles.
Windows stores the credential as user-bound DPAPI ciphertext in data. Outlook
can be the receiving mailbox; it is not a supported sender in this edition.

To update safely, extract the new ZIP into a new folder beside the old version;
do not overwrite the old program folder. Close both copies, double-click
import-data-from-old-version.cmd in the new folder, and drag the old version's
data folder into the window. The importer validates and backs up research data,
API/reminder settings, reminder history, and any Windows DPAPI-encrypted email
authorization code before changing anything. A failed import leaves old data
intact. Then start the new copy. If email reminders were enabled, open Settings
once and enable or migrate the reminder task so its saved path points to the
new folder. If Windows refuses registration, use the one-time administrator
launch described above. Keep the old folder until the new copy has been checked.

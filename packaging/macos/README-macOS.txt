Anthropology Canteen 1.1.1 — unsigned macOS portable beta

System requirement: macOS 13.5 or newer. The bundled Node.js 24.14.0 runtime
does not support older macOS releases.

1. Extract the complete ZIP. Do not run it from the ZIP preview.
2. Double-click "Anthropology Canteen.command" in the extracted folder. A
   Terminal window appears briefly while the background server becomes ready,
   then the default browser opens. The server does not require Terminal to stay open.
3. If macOS blocks this unsigned beta, use Finder's Open command or the
   Privacy & Security panel to approve this specific downloaded item once.
   Do not disable Gatekeeper or system-wide security.
4. If startup fails, double-click start-local.command and keep its Terminal
   window open for diagnostics. This unsigned beta intentionally has no `.app`
   wrapper because App Translocation can prevent access to sibling runtime files.

The package includes Node.js; no separate Node installation or account is
needed. Close every Anthropology Canteen browser tab to stop the background
server after about eight seconds. If no page connects, it stops after 90 seconds.

Your subscriptions, cached records, saved states, translations, and optional
API settings are stored only in this extracted folder's data directory. The
original ZIP is blank. Do not share a copy that you have already run if it
contains a data directory.

To move data from another extracted copy, close both copies and double-click
import-data-from-old-version.command. It validates the supported data/settings
schema, refuses to import while a live server PID is present, and backs up any
destination files before replacement.

This is an unsigned beta, not a signed or notarized Mac app. Native automated
tests cover startup, persistence, import, automatic shutdown, architecture,
permissions, and archive privacy. Finder, Gatekeeper, default-browser, and
visual/font behavior still require a person to test on real Apple Silicon
hardware; an Intel user test is also preferred.

# 🧙‍♂️ NetworkWizard

A Chrome DevTools extension for monitoring, analyzing, and debugging network requests.

## ✨ Features

- 📡 **Request Capture** - Automatically captures REST and GraphQL requests
- 🎯 **Smart Filtering** - Filter by type (REST/GQL), method, and status
- 🏷️ **Method Chips** - Multi-select method filters with dynamic detection of new methods
- 🔍 **Search** - Full-text search across call names and URLs
- 📋 **Expandable Details** - View headers, request body, and response body for each call
- 📎 **Copy Support** - Copy request/response bodies or generate cURL commands
- ⚡ **Real-time Updates** - Live capture with recording toggle
- 🔮 **GraphQL Error Detection** - Identifies GQL errors even on 200 responses
- 🚫 **Request Blocking** - Block specific REST URLs or GraphQL operations
- 🎭 **Response Override** - Mock responses with custom status, headers, and body
- ✏️ **Request Override** - Rewrite the outgoing request body before it is sent
- 🐢 **Request Delay** - Delay a request before it is sent, or hold its response, to test loading states and timeouts
- 🌐 **Scoping** - Every block, override, and delay applies either to the current origin or to all sites. A site rule and an all-sites rule can both exist for the same call; the site rule wins
- 📥 **Import/Export** - Import and export override configurations

## 📦 Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select the `NetworkWizard` directory
5. Open DevTools (F12) and find the "NetworkWizard" tab

## 🎮 Usage

### Filtering Requests

- **Type Filter** - Toggle between All, REST, and GQL requests
- **Method Filter** - Select one or more HTTP methods as chips; click `+` to add methods
- **Status Filter** - Filter by success or error responses
- **Search** - Type to filter by call name or URL

### Viewing Request Details

Click any row to expand and view:

- **Headers Tab** - General info, request headers, and response headers (collapsible)
- **Request Tab** - Request body with copy button
- **Response Tab** - Response body with copy button

### Actions

- **Override** - Create/edit response override (opens Overrides tab)
- **Delay** - Create/edit a delay for this call (opens Delays tab)
- **Block** - Block requests from being sent
- **Copy cURL** - Generate and copy cURL command from kebab menu

If a call is already covered by an existing rule, these buttons open that rule instead of creating a duplicate.

### Controls

- **Clear** - Remove all captured requests
- **Recording** - Toggle request capture on/off

### Managing Blocked Calls

- Use the **Blocked** tab to view and manage all blocked calls
- Toggle blocking on/off without removing from the list
- Blocked calls persist per origin and restore on reload

### Managing Overrides

- Use the **Overrides** tab to view and manage all response overrides
- Click any override row to expand and edit:
  - **Scope** - This site only, or all sites
  - **Match params/variables** - The checkbox on the scope row. **On by default**: the override only fires for requests whose query params / GQL variables match the list below. Uncheck it to **ignore params entirely**, so the override fires for every request to that endpoint or operation
  - **Override Request** - Replace the outgoing request body
  - **Status** - Custom status code and text (leave empty to keep original)
  - **Response Headers** - Edit as key-value pairs or raw JSON
  - **Response Body** - Custom response JSON
- Toggle overrides on/off without deleting configuration
- Import response body JSON or full override configuration
- Export individual overrides or all at once
- Overrides restore on reload and follow their scope across navigations

### Managing Delays

- Use the **Delays** tab to set a duration (1-300s) and pick the timing:
  - **Before Request** - Hold the request before it is sent
  - **After Response** - Let the request through, then hold the response
- Delays combine with overrides: a "before" delay also delays a mocked response

## ⚠️ Notes

- Blocking, overrides, and delays require the debugger, so Chrome shows a "started debugging this browser" banner while any rule is active. It detaches automatically once the last rule is removed or disabled.
- Request bodies above Chrome's inspection limit cannot be matched; the status drawer logs a warning when this happens.

## 📁 Project Structure

```
NetworkWizard/
├── manifest.json      # Extension configuration
├── background.js      # Service worker for pending requests
├── devtools.html      # DevTools entry point
├── devtools.js        # Panel creation
├── panel/
│   ├── panel.html     # Panel UI structure
│   ├── panel.css      # Styles
│   ├── panel.js       # Panel logic
│   ├── json-editor.js # Tree/text JSON viewer & editor
│   └── json-editor.css
├── test/              # Regression suites (no dependencies)
│   ├── harness.js     # chrome.* stubs + shared panel instance
│   └── dom.js         # Minimal DOM used by the render tests
└── icons/             # Extension icons
```

## 🧪 Tests

```
npm test
```

Runs every `test/*.test.js` suite in its own process against the real source files,
with `chrome.*` stubbed by `test/harness.js` and a minimal DOM provided by
`test/dom.js`. No dependencies, no build step.

Covers rule resolution and scoping, site-vs-global precedence, rule CRUD,
call-row and overrides-list reconciliation, action dispatch, request/response
interception, delay timing, storage migration and write batching, and HTML escaping.

## 📦 Packaging

```
npm run package
```

Builds `networkwizard-<version>.zip` **one directory above the repo**, so the
artifact is never inside the folder being zipped. Version comes from
`manifest.json`; keep it in step with `package.json`.

The script zips an explicit allowlist — `manifest.json`, `background.js`,
`devtools.html`, `devtools.js`, `panel/` and the three PNG icons. Everything
else (`test/`, `package.json`, this README, `icons/icon.svg`) is dev-only and
stays out. Don't hand-roll the zip: building it in place risks sweeping a
previous archive into the new one.

## 🔐 Permissions

- `webRequest` - Capture pending requests as they start
- `debugger` - Required for blocking requests and overriding responses
- `storage` - Persist blocked calls and overrides across sessions
- `<all_urls>` - Required to capture requests from any domain

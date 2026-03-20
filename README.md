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
- 🚫 **Request Blocking** - Block specific REST URLs or GraphQL operations (persisted per origin)
- 🎭 **Response Override** - Mock responses with custom status, headers, and body (persisted per origin)
- 📥 **Import/Export** - Import and export override configurations

### 🚧 Coming Soon

- 🐢 **Response Delay** - Simulate slow network conditions

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
- **Block** - Block requests from being sent
- **Copy cURL** - Generate and copy cURL command from kebab menu

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
  - **Match Params/Variables** - Override only specific requests (by query params or GQL variables)
  - **Status** - Custom status code and text (leave empty to keep original)
  - **Response Headers** - Edit as key-value pairs or raw JSON
  - **Response Body** - Custom response JSON
- Toggle overrides on/off without deleting configuration
- Import response body JSON or full override configuration
- Export individual overrides or all at once
- Overrides persist per origin and restore on reload

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
│   └── panel.js       # Panel logic
└── icons/             # Extension icons
```

## 🔐 Permissions

- `webRequest` - Capture pending requests as they start
- `debugger` - Required for blocking requests and overriding responses
- `storage` - Persist blocked calls and overrides across sessions
- `<all_urls>` - Required to capture requests from any domain

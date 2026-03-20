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

### 🚧 Coming Soon

- 🎭 **Response Override** - Mock responses for testing
- 🚫 **Request Blocking** - Block specific requests
- 🐢 **Response Delay** - Simulate slow network conditions
- 💾 **Export/Import** - Save and load captured requests

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

- **Override** - Override response (coming soon)
- **Block** - Block request (coming soon)
- **Copy cURL** - Generate and copy cURL command from kebab menu

### Controls

- **Clear** - Remove all captured requests
- **Recording** - Toggle request capture on/off

## 📁 Project Structure

```
NetworkWizard/
├── manifest.json      # Extension configuration
├── devtools.html      # DevTools entry point
├── devtools.js        # Panel creation
├── panel/
│   ├── panel.html     # Panel UI structure
│   ├── panel.css      # Styles
│   └── panel.js       # Panel logic
└── icons/             # Extension icons
```

## 🔐 Permissions

- `debugger` - Required for future override/block functionality
- `<all_urls>` - Required to capture requests from any domain

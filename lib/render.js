'use strict';

const fs = require('fs');
const path = require('path');

const DASHBOARD = path.join(__dirname, '..', 'dashboard', 'index.html');
const PLACEHOLDER = '/*__GP_DATA__*/null';

// Returns the dashboard HTML. With data ({goals:[...]}) it is a self-contained snapshot
// (no server needed); with null it polls /api/goals from the `serve` command.
function renderHtml(data) {
  const html = fs.readFileSync(DASHBOARD, 'utf8');
  if (data == null) return html;
  // Keep the JSON safe inside a <script> block: no "</script>" and no JS line separators.
  const json = JSON.stringify({ ...data, generatedAt: new Date().toISOString() })
    .replace(/</g, '\\u003c')
    .replace(new RegExp('\\u2028', 'g'), '\\u2028')
    .replace(new RegExp('\\u2029', 'g'), '\\u2029');
  return html.replace(PLACEHOLDER, () => json);
}

module.exports = { renderHtml };

const fs = require('fs');
const path = 'src/pages/AnalyticsPage.tsx';
let content = fs.readFileSync(path, 'utf8');

// Replace dark backgrounds
content = content.replace(/background:\s*['"]#111111['"]/g, "background: 'var(--bg-elevated)'");
content = content.replace(/background:\s*['"]#151515['"]/g, "background: 'var(--bg-elevated)'");
content = content.replace(/background:\s*['"]#111['"]/g, "background: 'var(--bg-elevated)'");

// Replace text colors
content = content.replace(/color:\s*['"]#ffffff['"]/g, "color: 'var(--text-primary)'");
content = content.replace(/color:\s*['"]#fff['"]/g, "color: 'var(--text-primary)'");
content = content.replace(/color:\s*['"]#aaa['"]/g, "color: '#666'");
content = content.replace(/color:\s*['"]#555['"]/g, "color: 'var(--text-muted)'");

// Replace white transparent colors with black transparent colors for borders/hover states
content = content.replace(/rgba\(255,\s*255,\s*255,/g, "rgba(0,0,0,");

fs.writeFileSync(path, content, 'utf8');
console.log('AnalyticsPage updated to light theme.');

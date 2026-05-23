import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve('assets');

const C = {
  bg: '#0C1222',
  panel: '#111A2E',
  panel2: '#131D30',
  panel3: '#162038',
  input: '#0A1019',
  coral: '#E8613A',
  coral2: '#F07A58',
  cyan: '#06B6D4',
  green: '#22C55E',
  amber: '#F59E0B',
  text: '#E2E8F0',
  muted: '#94A3B8',
  quiet: '#64748B',
  border: '#263044',
  border2: '#3B465C'
};

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function svg({ width, height, content }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#020617" flood-opacity="0.26"/>
    </filter>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${C.border}" stroke-width="1" opacity="0.35"/>
    </pattern>
  </defs>
  <rect width="${width}" height="${height}" fill="${C.bg}"/>
  <rect width="${width}" height="${height}" fill="url(#grid)" opacity="0.32"/>
  ${content}
</svg>
`;
}

function text(x, y, value, size, fill = C.text, weight = 600, family = 'Inter, Segoe UI, Arial, sans-serif', attrs = '') {
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="${family}" font-size="${size}" font-weight="${weight}" letter-spacing="0" ${attrs}>${esc(value)}</text>`;
}

function textLines(x, y, lines, size, fill = C.text, weight = 600, lineGap = 1.28, family = 'Inter, Segoe UI, Arial, sans-serif') {
  return lines.map((line, index) => text(x, y + index * Math.round(size * lineGap), line, size, fill, weight, family)).join('\n');
}

function mono(x, y, value, size = 20, fill = C.muted, weight = 500, attrs = '') {
  return text(x, y, value, size, fill, weight, 'JetBrains Mono, Consolas, Menlo, monospace', attrs);
}

function panel(x, y, w, h, label = '', accent = C.cyan) {
  return `<g filter="url(#shadow)">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${C.panel}" stroke="${C.border}" stroke-width="2"/>
    <rect x="${x}" y="${y}" width="${w}" height="6" rx="3" fill="${accent}"/>
    ${label ? text(x + 22, y + 42, label, 22, C.text, 700) : ''}
  </g>`;
}

function badge(x, y, value, color) {
  return `<g>
    <rect x="${x}" y="${y}" width="${value.length * 10 + 44}" height="34" rx="17" fill="${C.panel2}" stroke="${C.border2}" stroke-width="1.5"/>
    <circle cx="${x + 18}" cy="${y + 17}" r="5" fill="${color}"/>
    ${mono(x + 32, y + 22, value, 13, C.text, 700)}
  </g>`;
}

function arrow(x1, y1, x2, y2, color = C.coral) {
  const head = x2 > x1 ? `M ${x2 - 9} ${y2 - 7} L ${x2} ${y2} L ${x2 - 9} ${y2 + 7}` : `M ${x2 + 9} ${y2 - 7} L ${x2} ${y2} L ${x2 + 9} ${y2 + 7}`;
  return `<path d="M ${x1} ${y1} L ${x2} ${y2}" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="${head}" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function statusNode(x, y, label, sub, color) {
  return `<g>
    <rect x="${x}" y="${y}" width="196" height="86" rx="9" fill="${C.panel2}" stroke="${C.border}" stroke-width="1.5"/>
    <circle cx="${x + 28}" cy="${y + 30}" r="9" fill="${color}"/>
    ${text(x + 48, y + 34, label, 19, C.text, 700)}
    ${mono(x + 20, y + 64, sub, 13, C.muted)}
  </g>`;
}

function workflowNode(num, title, lines, color, x, y) {
  return `<g>
    <rect x="${x}" y="${y}" width="222" height="146" rx="11" fill="${C.panel}" stroke="${C.border2}" stroke-width="1.5"/>
    <circle cx="${x + 34}" cy="${y + 38}" r="18" fill="${color}"/>
    ${mono(x + 27, y + 45, num, 18, C.bg, 900)}
    ${text(x + 66, y + 45, title, 23, C.text, 800)}
    ${textLines(x + 24, y + 86, lines, 16, C.muted, 500, 1.35)}
  </g>`;
}

function receipt(x, y, w, h, title, color = C.green) {
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="${C.input}" stroke="${C.border2}" stroke-width="1.5"/>
    <path d="M ${x + 22} ${y + 24} H ${x + w - 22}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>
    ${mono(x + 22, y + 54, title, 16, C.text, 700)}
    <rect x="${x + 22}" y="${y + 76}" width="${w - 96}" height="8" rx="4" fill="${C.muted}" opacity="0.65"/>
    <rect x="${x + 22}" y="${y + 98}" width="${w - 52}" height="8" rx="4" fill="${C.muted}" opacity="0.45"/>
    <rect x="${x + 22}" y="${y + 120}" width="${w - 132}" height="8" rx="4" fill="${C.muted}" opacity="0.55"/>
    <circle cx="${x + w - 40}" cy="${y + 102}" r="12" fill="${color}"/>
  </g>`;
}

function socialCard() {
  const flow = [
    statusNode(680, 112, 'Doctor', 'reads boundary', C.cyan),
    statusNode(914, 112, 'Audit', 'local only', C.coral),
    statusNode(914, 260, 'Golden Loop', 'receipt proof', C.green),
    statusNode(680, 260, 'Safe Fixes', 'owner gate', C.amber)
  ].join('\n');

  return svg({
    width: 1280,
    height: 640,
    content: `
    <rect x="58" y="58" width="1164" height="524" rx="18" fill="${C.panel3}" stroke="${C.border}" stroke-width="2"/>
    <rect x="88" y="88" width="472" height="464" rx="12" fill="${C.bg}" stroke="${C.border}" stroke-width="1.5"/>
    ${mono(116, 132, 'AGORAGENTIC / LOCAL-FIRST OSS', 18, C.cyan, 800)}
    ${text(116, 194, 'Premortem', 54, C.text, 800, 'Space Grotesk, Inter, Segoe UI, sans-serif')}
    ${text(116, 254, 'Golden Loop', 54, C.text, 800, 'Space Grotesk, Inter, Segoe UI, sans-serif')}
    ${text(116, 314, 'Agent', 54, C.text, 800, 'Space Grotesk, Inter, Segoe UI, sans-serif')}
    ${textLines(118, 364, ['Failure-frame premortems, local readiness', 'receipts, and owner-approved fix paths.'], 22, C.muted, 500)}
    ${badge(116, 444, 'NO DATA SENT', C.green)}
    ${badge(116, 492, 'NO SPEND', C.cyan)}

    <rect x="620" y="84" width="540" height="430" rx="14" fill="${C.bg}" stroke="${C.cyan}" stroke-width="2"/>
    ${mono(646, 112, 'LOCAL AUDIT LOOP', 16, C.cyan, 800)}
    ${flow}
    ${arrow(876, 155, 914, 155, C.coral)}
    ${arrow(1012, 198, 1012, 260, C.coral)}
    ${arrow(914, 303, 876, 303, C.coral)}
    ${arrow(778, 260, 778, 198, C.coral)}
    ${receipt(680, 414, 430, 76, 'local-receipt.json', C.green)}
    <path d="M 620 534 H 1160" stroke="${C.border}" stroke-width="2"/>
    ${mono(648, 562, 'audit-guide.html  +  local-receipt.json  +  ide-fix-prompt.md', 15, C.muted)}
  `
  });
}

function readmeHero() {
  return svg({
    width: 1600,
    height: 900,
    content: `
    <rect x="70" y="64" width="1460" height="772" rx="18" fill="${C.panel3}" stroke="${C.border}" stroke-width="2"/>
    ${mono(110, 118, 'LOCAL-FIRST AGENT READINESS', 18, C.cyan, 800)}
    ${text(110, 188, 'Premortem + Golden Loop in one audit', 54, C.text, 800, 'Space Grotesk, Inter, Segoe UI, sans-serif')}
    ${text(112, 236, 'For installable AI agent repos: expose launch failure modes, prove no-spend readiness, and hand fixes to a local IDE agent.', 24, C.muted, 500)}

    ${panel(110, 294, 640, 234, 'Run locally', C.coral)}
    ${mono(142, 366, '$ npx agoragentic-premortem-golden-loop doctor --repo .', 21, C.text)}
    ${mono(142, 410, '$ npx agoragentic-premortem-golden-loop audit --repo .', 21, C.text)}
    <rect x="142" y="450" width="236" height="34" rx="7" fill="${C.input}" stroke="${C.border}"/>
    ${mono(162, 473, 'no network by default', 15, C.green, 700)}
    <rect x="394" y="450" width="172" height="34" rx="7" fill="${C.input}" stroke="${C.border}"/>
    ${mono(414, 473, 'no API key', 15, C.cyan, 700)}
    <rect x="582" y="450" width="126" height="34" rx="7" fill="${C.input}" stroke="${C.border}"/>
    ${mono(602, 473, 'no wallet', 15, C.amber, 700)}

    <rect x="812" y="294" width="638" height="390" rx="14" fill="${C.bg}" stroke="${C.cyan}" stroke-width="2"/>
    ${mono(846, 340, 'LOCAL MACHINE BOUNDARY', 17, C.cyan, 800)}
    ${statusNode(846, 378, 'Premortem HTML', 'failure-frame report', C.coral)}
    ${statusNode(1082, 378, 'Golden Loop', 'readiness receipt', C.green)}
    ${statusNode(846, 512, 'Self-Heal Plan', 'additive only', C.amber)}
    ${statusNode(1082, 512, 'IDE Handoff', 'reviewed patch', C.cyan)}
    ${arrow(1042, 421, 1082, 421, C.coral)}
    ${arrow(1180, 464, 1180, 512, C.coral)}
    ${arrow(1082, 555, 1042, 555, C.coral)}
    ${arrow(944, 512, 944, 464, C.coral)}

    <rect x="110" y="580" width="640" height="104" rx="12" fill="${C.panel}" stroke="${C.border}" stroke-width="1.5"/>
    ${text(142, 626, 'Outputs you can inspect', 25, C.text, 700)}
    ${mono(142, 662, 'audit-guide.html  local-receipt.json  ide-fix-prompt.md', 18, C.muted)}

    <rect x="110" y="724" width="1340" height="64" rx="12" fill="${C.input}" stroke="${C.border2}" stroke-width="1.5"/>
    <circle cx="144" cy="756" r="8" fill="${C.green}"/>
    ${text(166, 764, 'Self-heal creates missing scaffolds only after --apply-safe-fixes. It never deletes, overwrites, deploys, publishes, or spends.', 22, C.text, 600)}
  `
  });
}

function workflowDiagram() {
  const steps = [
    ['1', 'Doctor', ['Explain reads, writes,', 'and hard boundaries.'], C.cyan, 92, 252],
    ['2', 'Audit', ['Scan release readiness', 'and operating risks.'], C.coral, 358, 252],
    ['3', 'Premortem', ['Generate six-month', 'failure-frame report.'], C.amber, 624, 252],
    ['4', 'Golden Loop', ['Write local no-spend', 'readiness receipt.'], C.green, 890, 252],
    ['5', 'Handoff', ['Create IDE prompt from', 'findings and guardrails.'], C.cyan, 358, 548],
    ['6', 'Owner Review', ['Apply only approved', 'additive scaffolds.'], C.coral, 624, 548]
  ];
  const nodes = steps.map(([num, title, lines, color, x, y]) => workflowNode(num, title, lines, color, x, y)).join('\n');

  return svg({
    width: 1400,
    height: 1000,
    content: `
    ${mono(88, 104, 'AGORAGENTIC / WORKFLOW', 18, C.cyan, 800)}
    ${text(88, 168, 'Local Premortem Golden Loop', 52, C.text, 800, 'Space Grotesk, Inter, Segoe UI, sans-serif')}
    <rect x="70" y="188" width="1260" height="552" rx="18" fill="${C.panel3}" stroke="${C.cyan}" stroke-width="2"/>
    ${mono(100, 228, 'LOCAL MACHINE BOUNDARY - NO NETWORK BY DEFAULT', 18, C.cyan, 800)}
    ${nodes}
    ${arrow(314, 325, 358, 325, C.coral)}
    ${arrow(580, 325, 624, 325, C.coral)}
    ${arrow(846, 325, 890, 325, C.coral)}
    <path d="M 1000 398 C 1030 498, 808 532, 736 548" stroke="${C.coral}" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M 719 540 L 704 552 L 723 558" stroke="${C.coral}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    ${arrow(580, 621, 624, 621, C.coral)}

    <rect x="1088" y="500" width="194" height="104" rx="10" fill="${C.bg}" stroke="${C.border2}" stroke-width="1.5"/>
    ${mono(1114, 538, 'optional', 15, C.quiet, 700)}
    ${text(1114, 570, 'No-spend canaries', 20, C.text, 700)}
    <path d="M 846 622 C 1020 674, 1098 620, 1148 604" stroke="${C.cyan}" stroke-width="3" fill="none" stroke-dasharray="8 10"/>

    <rect x="92" y="792" width="376" height="112" rx="12" fill="${C.input}" stroke="${C.border}" stroke-width="1.5"/>
    ${text(122, 836, 'Receipts', 25, C.text, 800)}
    ${mono(122, 872, 'local-receipt.json / audit.json', 17, C.muted)}
    <rect x="512" y="792" width="376" height="112" rx="12" fill="${C.input}" stroke="${C.border}" stroke-width="1.5"/>
    ${text(542, 836, 'Reports', 25, C.text, 800)}
    ${mono(542, 872, 'audit-guide.html / premortem.html', 17, C.muted)}
    <rect x="932" y="792" width="376" height="112" rx="12" fill="${C.input}" stroke="${C.border}" stroke-width="1.5"/>
    ${text(962, 836, 'Fix Path', 25, C.text, 800)}
    ${mono(962, 872, 'ide-fix-prompt.md / owner gate', 17, C.muted)}
  `
  });
}

function icon() {
  return svg({
    width: 1024,
    height: 1024,
    content: `
    <rect x="140" y="140" width="744" height="744" rx="120" fill="${C.panel3}" stroke="${C.border2}" stroke-width="6"/>
    <circle cx="512" cy="512" r="264" fill="${C.bg}" stroke="${C.border}" stroke-width="8"/>
    <path d="M 350 398 A 210 210 0 0 1 674 398" stroke="${C.coral}" stroke-width="70" fill="none" stroke-linecap="round"/>
    <path d="M 674 626 A 210 210 0 0 1 350 626" stroke="${C.coral}" stroke-width="70" fill="none" stroke-linecap="round"/>
    <path d="M 264 512 H 350" stroke="${C.cyan}" stroke-width="30" stroke-linecap="round"/>
    <path d="M 674 512 H 760" stroke="${C.cyan}" stroke-width="30" stroke-linecap="round"/>
    <path d="M 416 348 H 608 Q 638 348 638 378 V 648 L 582 616 L 526 648 L 470 616 L 414 648 V 378 Q 414 348 416 348" fill="${C.panel}" stroke="${C.coral2}" stroke-width="22" stroke-linejoin="round"/>
    <path d="M 472 444 H 574 M 472 506 H 574 M 472 568 H 542" stroke="${C.coral2}" stroke-width="28" stroke-linecap="round"/>
    <circle cx="512" cy="258" r="58" fill="${C.green}" stroke="${C.bg}" stroke-width="16"/>
    <path d="M 486 258 L 506 278 L 542 236" stroke="${C.bg}" stroke-width="22" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="726" cy="512" r="58" fill="${C.amber}" stroke="${C.bg}" stroke-width="16"/>
    <path d="M 726 478 V 518 M 726 548 V 552" stroke="${C.bg}" stroke-width="22" stroke-linecap="round"/>
  `
  });
}

await fs.mkdir(OUT, { recursive: true });
await Promise.all([
  fs.writeFile(path.join(OUT, 'social-card.svg'), socialCard(), 'utf8'),
  fs.writeFile(path.join(OUT, 'readme-hero.svg'), readmeHero(), 'utf8'),
  fs.writeFile(path.join(OUT, 'workflow-diagram.svg'), workflowDiagram(), 'utf8'),
  fs.writeFile(path.join(OUT, 'icon.svg'), icon(), 'utf8')
]);

console.log('Wrote deterministic SVG brand assets to assets/.');

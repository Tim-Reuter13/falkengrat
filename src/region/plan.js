import { bounds, sites, mainRoad, forestRoad, hikingTrail, river, creek, lake, lakeOutflow } from './layout.js';

export function drawPlan(canvas, position) {
  const c = canvas.getContext('2d');
  const { width, height } = canvas, margin = 28;
  const scale = (width - 2 * margin) / (bounds.east - bounds.west);
  const mapHeight = (bounds.south - bounds.north) * scale;
  const top = (height - mapHeight) / 2;
  const plot = (x, z) => [margin + (x - bounds.west) * scale, top + (z - bounds.north) * scale];
  c.fillStyle = '#e9e4d1'; c.fillRect(0, 0, width, height);
  c.fillStyle = '#d7dcc8'; c.fillRect(margin, top, width - 2 * margin, mapHeight);
  c.strokeStyle = '#858c734c'; c.lineWidth = 1;
  c.beginPath();
  for (let x = bounds.west; x <= bounds.east; x += 3000) {
    c.moveTo(...plot(x, bounds.north)); c.lineTo(...plot(x, bounds.south));
  }
  for (let z = bounds.north; z <= bounds.south; z += 3000) {
    c.moveTo(...plot(bounds.west, z)); c.lineTo(...plot(bounds.east, z));
  }
  c.stroke();

  function line(trace, xAxis, color, size, dash = []) {
    c.beginPath();
    c.setLineDash(dash); c.strokeStyle = color; c.lineWidth = size;
    for (let t = trace.first; ; t = Math.min(t + 80, trace.last)) {
      const xy = xAxis ? plot(t, trace.value(t)) : plot(trace.value(t), t);
      if (t === trace.first) c.moveTo(...xy); else c.lineTo(...xy);
      if (t === trace.last) break;
    }
    c.stroke(); c.setLineDash([]);
  }
  c.lineCap = 'round'; c.lineJoin = 'round';
  line(river, false, '#588197', 4);
  line(creek, false, '#588197', 2);
  line(lakeOutflow, false, '#588197', 2);
  c.beginPath(); c.ellipse(...plot(lake.x, lake.z), lake.rx * scale * .93, lake.rz * scale * .93, 0, 0, Math.PI * 2);
  c.fillStyle = '#588197'; c.fill();
  line(mainRoad, true, '#50544a', 5);
  line(mainRoad, true, '#b8af97', 2);
  line(forestRoad, false, '#897856', 3);
  line(hikingTrail, false, '#8a4934', 2, [4, 5]);

  c.font = '600 16px system-ui';
  const labels = [[sites.town, 14, -12], [sites.pass, 13, -17], [sites.lake, 16, -24],
    [sites.trailhead, 15, -12], [sites.lookout, 16, -13]];
  for (const [site, dx, dy] of labels) {
    const [x, y] = plot(site.x, site.z);
    c.fillStyle = '#435747';
    c.beginPath(); c.arc(x, y, site === sites.town ? 6 : 4, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#e9e4d1'; c.lineWidth = 4;
    c.strokeText(site.name, x + dx, y + dy);
    c.fillStyle = '#25392e'; c.fillText(site.name, x + dx, y + dy);
  }
  const [x, y] = plot(position.x, position.z);
  c.beginPath(); c.arc(x, y, 7.5, 0, Math.PI * 2);
  c.fillStyle = '#bd7048'; c.fill(); c.strokeStyle = '#f9f4e3'; c.lineWidth = 2.5; c.stroke();
  c.fillStyle = '#344b3b'; c.font = '600 14px system-ui';
  c.fillText('N ↑', width - 63, top + 23);
  const yScale = height - 19, end = margin + 5000 * scale;
  c.strokeStyle = '#344b3b'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(margin, yScale - 4); c.lineTo(margin, yScale);
  c.lineTo(end, yScale); c.lineTo(end, yScale - 4); c.stroke();
  c.fillText('5 km', end + 9, yScale + 4);
}

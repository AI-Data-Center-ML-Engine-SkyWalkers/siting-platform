// Export the current shortlist and community events: Excel for analysts, GeoJSON for QGIS, ArcGIS or Mapbox.

const PILLARS = ['power', 'water', 'climate', 'cooling', 'land', 'community'];

function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

function siteRow(s, i) {
  const row = {
    rank: i + 1,
    site_id: s.site_id,
    name: s.name,
    state: s.state,
    county_fips: s.county_fips,
    latitude: s.lat,
    longitude: s.lon,
    score: Math.round((s.final_score ?? s.score) * 10) / 10,
    model_score: Math.round((s.base_score ?? s.score) * 10) / 10,
    rank_change_from_community: s.rank_change ?? 0,
  };
  for (const p of PILLARS) row[`pillar_${p}`] = s.pillars?.[p] ?? null;
  row.strengths = (s.pros || []).join('; ');
  row.weaknesses = (s.cons || []).join('; ');
  row.community_notes = (s.community?.notes || []).join(' ');
  return row;
}

export function exportGeoJSON(sites, events) {
  const fc = {
    type: 'FeatureCollection',
    features: [
      ...sites.map((s, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, properties: { layer: 'site', ...siteRow(s, i) } })),
      ...(events?.features || []).map((f) => ({ ...f, properties: { layer: 'community_event', ...f.properties } })),
    ],
  };
  download(`sitewelleco-sites-${stamp()}.geojson`, new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' }));
}

export async function exportExcel(sites, events) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sites.map(siteRow)), 'Sites');
  const eventRows = (events?.features || []).map((f) => ({
    date: (f.properties.published_at || '').slice(0, 10),
    region: f.properties.region,
    event: f.properties.event_type,
    stance: f.properties.stance,
    severity: f.properties.severity,
    summary: f.properties.summary,
    source: f.properties.outlet,
    url: f.properties.url,
    latitude: f.geometry.coordinates[1],
    longitude: f.geometry.coordinates[0],
  }));
  if (eventRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(eventRows), 'Community events');
  XLSX.writeFile(wb, `sitewelleco-sites-${stamp()}.xlsx`);
}

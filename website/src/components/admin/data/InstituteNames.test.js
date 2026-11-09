import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { getInstituteDisplayName, getInstituteSearchText } from './InstituteNames.js';

const aliases = [
  'ucsd', 'UCSD', 'UC San Diego', ' UC San Diego ',
  'University of California San Diego', 'University of California, San Diego',
  'University of California at San Diego', 'University of California–San Diego',
];

test('all supported university names share one display label, with or without an ID', () => {
  for (const name of aliases) {
    assert.equal(getInstituteDisplayName({ full_name: name }), 'UC San Diego');
    assert.equal(getInstituteDisplayName({ institute_id: name }), 'UC San Diego');
  }
  assert.equal(getInstituteDisplayName({ institute_id: 'ucsd', full_name: 'An outdated label' }), 'UC San Diego');
  assert.equal(getInstituteDisplayName({ id: 'ucsd', instituteName: 'UCSD' }), 'UC San Diego');
});

test('other institutions retain their supplied names and IDs', () => {
  assert.equal(getInstituteDisplayName({ institute_id: 'mit', full_name: 'Massachusetts Institute of Technology' }), 'Massachusetts Institute of Technology');
  assert.equal(getInstituteDisplayName({ institute_id: 'campus_a' }), 'campus_a');
  assert.equal(getInstituteDisplayName({ full_name: '  West Campus  ' }), 'West Campus');
  assert.equal(getInstituteDisplayName(null), 'Institute');
  assert.equal(getInstituteDisplayName(), 'Institute');
});

test('institution search accepts the abbreviation, formal name, and displayed name', () => {
  const searchText = getInstituteSearchText({ id: 'ucsd', instituteName: 'UC San Diego' });
  for (const value of ['ucsd', 'uc san diego', 'university of california san diego']) {
    assert.ok(searchText.includes(value), value);
  }
});

// Load the production navigation and route-label functions without initializing
// browser authentication. The formatting/filtering implementations remain intact.
const asModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const namesUrl = new URL('./InstituteNames.js', import.meta.url).href;
const routeSource = readFileSync(new URL('../routing/AdminRouteUtils.jsx', import.meta.url), 'utf8')
  .replace("'../data/InstituteNames.js'", JSON.stringify(namesUrl));
const routes = await import(asModule(routeSource));
const navigationSource = readFileSync(new URL('../navigation/SidebarData.jsx', import.meta.url), 'utf8')
  .replace('"../routing/AdminRouteUtils"', JSON.stringify(asModule(routeSource)))
  .replace("'../data/InstituteNames.js'", JSON.stringify(namesUrl))
  .replace('import { fetchSensorDirectory } from "../data/SensorDirectoryData";',
    'const fetchSensorDirectory = async () => ({ institutes: [], sensors: [] });');
const { formatCampusNavigation, filterCampusNavigation, getSearchTokens } = await import(asModule(navigationSource));

test('sidebar and breadcrumb labels agree while navigation keeps the original institution ID', () => {
  // Include an area and a corridor so the fixture supports each product's hierarchy.
  const rows = [{ id: 'area-1', name: 'Library', buildings: [], institute_id: 'ucsd',
    sensor_id: 'radar-1', area_name: 'Library', corridor_name: 'Gilman Lane' }];
  for (const name of aliases) {
    const navigation = formatCampusNavigation([{ institute_id: 'ucsd', full_name: name }], rows);
    assert.equal(navigation[0].instituteName, 'UC San Diego');
    assert.equal(navigation[0].id, 'ucsd');
    assert.equal(navigation[0].areas.length, 1);
    assert.equal(routes.formatAdminRouteLabel('ucsd'), navigation[0].instituteName);
    for (const query of ['UCSD', 'UC San Diego', 'University of California San Diego']) {
      assert.equal(filterCampusNavigation(navigation, getSearchTokens(query)).length, 1, query);
    }
  }
  assert.ok(routes.getAdminCollegePath('ucsd').endsWith('/ucsd'));
  assert.equal(routes.formatAdminRouteLabel('muir_college'), 'Muir College');
  assert.equal(routes.formatAdminRouteLabel(undefined), '');
});

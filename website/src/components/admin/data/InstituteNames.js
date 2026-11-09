const UC_SAN_DIEGO_NAME = 'UC San Diego';
const UC_SAN_DIEGO_ALIASES = new Set([
  'ucsd',
  'ucsandiego',
  'universityofcaliforniasandiego',
  'universityofcaliforniaatsandiego',
]);

const normalizeName = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Format names for display without changing the IDs used by routes and queries.
export const getInstituteDisplayName = (institute = {}) => {
  const id = String(institute?.institute_id || institute?.id || '').trim();
  const name = String(institute?.full_name || institute?.instituteName || '').trim();
  if ([id, name].some((value) => UC_SAN_DIEGO_ALIASES.has(normalizeName(value)))) {
    return UC_SAN_DIEGO_NAME;
  }
  return name || id || 'Institute';
};

export const getInstituteSearchText = (institute = {}) => {
  const name = getInstituteDisplayName(institute);
  const aliases = name === UC_SAN_DIEGO_NAME
    ? 'UCSD University of California San Diego University of California at San Diego'
    : '';
  return [name, institute.id, institute.institute_id, institute.full_name, aliases]
    .filter(Boolean).join(' ').toLowerCase();
};

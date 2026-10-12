/**
 * Mirrored Epic patient-access endpoints (open.epic.com/MyApps/Endpoints, checked 2026-10-12). Epic asks
 * apps not to query the endpoint directory at runtime, so the two organizations Ben uses are pinned here
 * and refreshed by hand when the directory changes.
 */
export interface FhirOrganization {
  id: string;
  name: string;
  vendor: 'epic';
  fhirBase: string;
  portal: string;
  directorySource: string;
}

export const FHIR_ORGANIZATIONS: FhirOrganization[] = [
  { id: 'weill_cornell', name: 'Weill Cornell Medicine', vendor: 'epic', fhirBase: 'https://epicproxy-pub.et1089.epichosted.com/FHIRProxy/api/FHIR/R4/', portal: 'Weill Cornell Connect (MyChart)', directorySource: 'https://open.epic.com/MyApps/Endpoints' },
  { id: 'nyu_langone', name: 'NYU Langone Health', vendor: 'epic', fhirBase: 'https://epicfhir.nyumc.org/FHIRPRD/api/FHIR/R4/', portal: 'NYU Langone Health MyChart', directorySource: 'https://open.epic.com/MyApps/Endpoints' },
];

export function fhirOrganizationById(id: string): FhirOrganization | undefined {
  return FHIR_ORGANIZATIONS.find((o) => o.id === id);
}

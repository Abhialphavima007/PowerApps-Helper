'use strict';
const library = 'abhi_/scripts/deployment-profile.js';
const registration = '<formLibraries><Library name="' + library + '" libraryUniqueId="{f498fda8-5ea6-438f-b970-a7955f75daa6}" /></formLibraries><events><event name="onload" application="false" active="false"><Handlers><Handler functionName="ABHI.DeploymentProfile.onLoad" libraryName="' + library + '" handlerUniqueId="{8130d633-d534-4897-a2e5-27458e0e4809}" enabled="true" parameters="" passExecutionContext="true" /></Handlers></event></events>';
function addProfileAccountPicker(xml) {
  if (!xml.includes('datafieldname="abhi_flowuserid"') || !xml.includes('</form>')) {
    throw new Error('Expected the existing deployment profile form and trust field.');
  }
  if (xml.includes('abhi_approvalflowuser') || xml.includes(library)) {
    throw new Error('Profile picker is already present; review the form before editing.');
  }
  // Preserve the shipped form and unrelated customizations. The supported
  // onLoad handler registers its own lookup-change and save handlers once.
  const cell = '<row><cell id="{bf203b32-224e-4bcf-b366-20ef47011d40}" showlabel="true" rowspan="1" colspan="1"><labels><label description="Approval flow account" languagecode="1033" /></labels><control id="abhi_approvalflowuser" classid="{270BD3DB-D9AF-4782-9025-509E298DEC0A}" datafieldname="abhi_approvalflowuser" disabled="false" /></cell></row>';
  const rowPattern = /<row><cell\b[^>]*>(?:(?!<\/cell>).)*<control\b[^>]*datafieldname="abhi_flowuserid"[^>]*\/>\s*<\/cell><\/row>/s;
  if (!rowPattern.test(xml) || xml.includes('<events>') || xml.includes('<formLibraries>')) {
    throw new Error('Unexpected existing form registration; merge and review explicitly.');
  }
  xml = xml.replace(rowPattern, row => cell + row.replace('disabled="false"', 'disabled="true"'));
  return xml.replace('</form>', registration + '</form>');
}
module.exports = { addProfileAccountPicker, library, registration };

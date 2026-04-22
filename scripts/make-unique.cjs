const fs = require('fs');

const inputFile = process.argv[2] || 'test-export-strings.csv';
const outputFile = process.argv[3] || 'test-export-strings-unique.csv';

const timestamp = Date.now();
const csv = fs.readFileSync(inputFile, 'utf8');

// Split into lines
const lines = csv.split('\n');
const header = lines[0];
const dataLines = lines.slice(1);

// Process each line
const updatedLines = dataLines.map(line => {
  if (!line.trim()) return line;

  // Replace emails (add +timestamp before @)
  line = line.replace(/([^,]+)@([^,]+)/g, `$1+${timestamp}@$2`);

  // Replace user external_ids (auth0|user_XXX)
  line = line.replace(/auth0\|user_(\d+)/g, `auth0|user_$1_${timestamp}`);

  // Replace org external_ids
  line = line.replace(/org_9fJ6miTmBiRxES00/g, `org_9fJ6miTmBiRxES00_${timestamp}`);
  line = line.replace(/org_gmmB4ckByYuWZDKv/g, `org_gmmB4ckByYuWZDKv_${timestamp}`);
  line = line.replace(/org_XVFSHPIbMivFIlwU/g, `org_XVFSHPIbMivFIlwU_${timestamp}`);
  line = line.replace(/org_gamma_003/g, `org_gamma_003_${timestamp}`);
  line = line.replace(/org_beta_002/g, `org_beta_002_${timestamp}`);
  line = line.replace(/org_acme_001/g, `org_acme_001_${timestamp}`);

  return line;
});

// Combine back
const updated = [header, ...updatedLines].join('\n');
fs.writeFileSync(outputFile, updated);
console.log(`Created ${outputFile} with timestamp suffix: ${timestamp}`);
console.log(`Updated emails: user@domain.com -> user+${timestamp}@domain.com`);
console.log(`Updated user external_ids: auth0|user_XXX -> auth0|user_XXX_${timestamp}`);
console.log(`Updated org external_ids with suffix _${timestamp}`);

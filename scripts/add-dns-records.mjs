/**
 * Adds SPF and DKIM DNS records for Oracle Cloud Email Delivery
 * to Cloudflare via their API. Uses CLOUDFLARE_API_TOKEN env var.
 *
 * Usage: CLOUDFLARE_API_TOKEN=xxx node scripts/add-dns-records.mjs
 */

const ZONE_NAME = 'shyden.co.uk';
const ACCOUNT_ID = '9315582c39b627dca58dfa83602db385';

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  console.error('Set CLOUDFLARE_API_TOKEN env var first');
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json',
};

async function api(path, method = 'GET', body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function main() {
  // 1. Get zone ID
  const zones = await api(`/zones?name=${ZONE_NAME}&account.id=${ACCOUNT_ID}`);
  if (!zones.success || !zones.result.length) {
    console.error('Zone not found:', zones);
    process.exit(1);
  }
  const zoneId = zones.result[0].id;
  console.log(`Zone: ${ZONE_NAME} (${zoneId})`);

  // 2. Check for existing SPF record
  const existing = await api(`/zones/${zoneId}/dns_records?type=TXT&name=${ZONE_NAME}`);
  const hasSPF = existing.result?.some(r => r.content?.includes('v=spf1'));

  if (hasSPF) {
    console.log('SPF record already exists — updating...');
    const spfRecord = existing.result.find(r => r.content?.includes('v=spf1'));
    // Merge Oracle into existing SPF
    if (!spfRecord.content.includes('rp.oracleemaildelivery.com')) {
      const newContent = spfRecord.content.replace('~all', 'include:rp.oracleemaildelivery.com ~all');
      await api(`/zones/${zoneId}/dns_records/${spfRecord.id}`, 'PUT', {
        type: 'TXT',
        name: ZONE_NAME,
        content: newContent,
        ttl: 3600,
      });
      console.log('SPF updated:', newContent);
    } else {
      console.log('SPF already includes Oracle — skipping');
    }
  } else {
    // Create new SPF record
    const result = await api(`/zones/${zoneId}/dns_records`, 'POST', {
      type: 'TXT',
      name: ZONE_NAME,
      content: 'v=spf1 include:rp.oracleemaildelivery.com ~all',
      ttl: 3600,
    });
    console.log('SPF created:', result.success ? 'OK' : result.errors);
  }

  // 3. Add DKIM CNAME record for Oracle Email Delivery
  // Oracle uses a specific DKIM selector format
  const dkimName = `${ZONE_NAME.replace(/\./g, '-')}._domainkey.${ZONE_NAME}`;
  const dkimTarget = `${ZONE_NAME.replace(/\./g, '-')}.dkim.oracleemaildelivery.com`;

  const existingDkim = await api(`/zones/${zoneId}/dns_records?type=CNAME&name=${dkimName}`);
  if (existingDkim.result?.length > 0) {
    console.log('DKIM CNAME already exists — skipping');
  } else {
    const result = await api(`/zones/${zoneId}/dns_records`, 'POST', {
      type: 'CNAME',
      name: dkimName,
      content: dkimTarget,
      ttl: 3600,
      proxied: false,
    });
    console.log('DKIM CNAME created:', result.success ? 'OK' : result.errors);
  }

  // 4. Add DMARC record
  const dmarcName = `_dmarc.${ZONE_NAME}`;
  const existingDmarc = await api(`/zones/${zoneId}/dns_records?type=TXT&name=${dmarcName}`);
  if (existingDmarc.result?.length > 0) {
    console.log('DMARC already exists — skipping');
  } else {
    const result = await api(`/zones/${zoneId}/dns_records`, 'POST', {
      type: 'TXT',
      name: dmarcName,
      content: 'v=DMARC1; p=none; rua=mailto:dmarc@shyden.co.uk',
      ttl: 3600,
    });
    console.log('DMARC created:', result.success ? 'OK' : result.errors);
  }

  console.log('\nDone! Verify with: nslookup -type=TXT shyden.co.uk');
}

main().catch(console.error);

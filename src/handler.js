// Meneruskan data CSV dari Google Sheet dengan cache di server tepi Cloudflare.
// Worker hanya mengalirkan data (tanpa membaca isinya), jadi pemakaian CPU sangat kecil.
// Data diolah di peramban pengunjung, sehingga ratusan pengunjung tidak membebani server.
const MASTER_ID = '1vcQ8iIARrUS_L1mXcXFu3d6DWWZgqBESBXSm5FsFRKc';  // Kode Store, Nama Store, NAMA FRA, NAMA REGIONAL

function teks(pesan, status) {
  return new Response(pesan, { status: status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function linkPublikasi(u) {
  u = String(u || '').trim();
  if (!u) throw new Error('BON_CSV_URL belum diisi di Variables and Secrets.');
  if (/\/(edit|export)|\/gviz\//.test(u)) throw new Error('BON_CSV_URL harus link Publish to web (tab Bon, format CSV).');
  u = u.replace('/pubhtml', '/pub').replace('output=html', 'output=csv');
  if (!/output=/.test(u)) u += (u.indexOf('?') >= 0 ? '&' : '?') + 'output=csv';
  return u;
}

function petaArsip(s) {
  const out = {};
  String(s || '').split(',').forEach(function (b) {
    const i = b.indexOf('=');
    if (i > 0) out[b.slice(0, i).trim()] = b.slice(i + 1).trim();
  });
  return out;
}

export async function tangani(request, env, nama, waitUntil) {
  try {
    const url = new URL(request.url);
    if (env.DASH_PIN && url.searchParams.get('pin') !== String(env.DASH_PIN)) return teks('PIN salah.', 401);

    let sumber, ttl;
    if (nama === 'bon') {
      sumber = linkPublikasi(env.BON_CSV_URL); ttl = 60;
    } else if (nama === 'arsip') {
      const bln = url.searchParams.get('bln') || '';
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(bln)) return teks('Bulan tidak valid.', 400);
      const id = petaArsip(env.ARSIP_IDS)[bln.slice(0, 4)];
      if (!id) return new Response(null, { status: 204 });
      sumber = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(id) + '/gviz/tq?tqx=out:csv&sheet=' + bln;
      ttl = 300;
    } else if (nama === 'master') {
      const m = String(env.MASTER_CSV_URL || '').trim();
      sumber = m ? (m.indexOf('/pub') >= 0 ? linkPublikasi(m) : m)
        : 'https://docs.google.com/spreadsheets/d/' + MASTER_ID + '/export?format=csv' + (env.MASTER_GID ? '&gid=' + encodeURIComponent(env.MASTER_GID) : '');
      ttl = 600;
    } else {
      return teks('Tidak ditemukan.', 404);
    }

    const cache = caches.default;
    const kunci = new Request(sumber);
    const kirim = function (body) {
      // ke peramban: cache pribadi singkat; cache bersama di server tepi disimpan terpisah dengan masa berlaku ttl
      return new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'private, max-age=30' } });
    };

    const ada = await cache.match(kunci);
    if (ada) return kirim(ada.body);

    const asal = await fetch(sumber, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' });
    if (!asal.ok) return teks('Sumber data gagal dibaca (kode ' + asal.status + ').', 502);
    if (String(asal.headers.get('content-type') || '').indexOf('text/html') >= 0) {
      return teks('Link mengembalikan halaman web, bukan CSV. Periksa pengaturan berbagi atau publikasi.', 502);
    }
    const simpan = new Response(asal.body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'public, max-age=' + ttl } });
    waitUntil(cache.put(kunci, simpan.clone()));
    return kirim(simpan.body);
  } catch (e) {
    return teks(e.message || String(e), 500);
  }
}

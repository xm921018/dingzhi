(function(nacl) {
'use strict';

// Ported in 2014 by Dmitry Chestnykh and Devi Mandiri.
// Public domain.
//
// Implementation derived from TweetNaCl version 20140427.
// See for details: http://tweetnacl.cr.yp.to/

var u64 = function(h, l) { this.hi = h|0 >>> 0; this.lo = l|0 >>> 0; };
var gf = function(init) {
  var i, r = new Float64Array(16);
  if (init) for (i = 0; i < init.length; i++) r[i] = init[i];
  return r;
};

//  Pluggable, initialized in high-level API below.
var randombytes = function(/* x, n */) { throw new Error('no PRNG'); };

var _0 = new Uint8Array(16);
var _9 = new Uint8Array(32); _9[0] = 9;

var gf0 = gf(),
    gf1 = gf([1]),
    _121665 = gf([0xdb41, 1]),
    D = gf([0x78a3, 0x1359, 0x4dca, 0x75eb, 0xd8ab, 0x4141, 0x0a4d, 0x0070, 0xe898, 0x7779, 0x4079, 0x8cc7, 0xfe73, 0x2b6f, 0x6cee, 0x5203]),
    D2 = gf([0xf159, 0x26b2, 0x9b94, 0xebd6, 0xb156, 0x8283, 0x149a, 0x00e0, 0xd130, 0xeef3, 0x80f2, 0x198e, 0xfce7, 0x56df, 0xd9dc, 0x2406]),
    X = gf([0xd51a, 0x8f25, 0x2d60, 0xc956, 0xa7b2, 0x9525, 0xc760, 0x692c, 0xdc5c, 0xfdd6, 0xe231, 0xc0a4, 0x53fe, 0xcd6e, 0x36d3, 0x2169]),
    Y = gf([0x6658, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666]),
    I = gf([0xa0b0, 0x4a0e, 0x1b27, 0xc4ee, 0xe478, 0xad2f, 0x1806, 0x2f43, 0xd7a7, 0x3dfb, 0x0099, 0x2b4d, 0xdf0b, 0x4fc1, 0x2480, 0x2b83]);

function L32(x, c) { return (x << c) | (x >>> (32 - c)); }

function ld32(x, i) {
  var u = x[i+3] & 0xff;
  u = (u<<8)|(x[i+2] & 0xff);
  u = (u<<8)|(x[i+1] & 0xff);
  return (u<<8)|(x[i+0] & 0xff);
}

function dl64(x, i) {
  var h = (x[i] << 24) | (x[i+1] << 16) | (x[i+2] << 8) | x[i+3];
  var l = (x[i+4] << 24) | (x[i+5] << 16) | (x[i+6] << 8) | x[i+7];
  return new u64(h, l);
}

function st32(x, j, u) {
  var i;
  for (i = 0; i < 4; i++) { x[j+i] = u & 255; u >>>= 8; }
}

function ts64(x, i, u) {
  x[i]   = (u.hi >> 24) & 0xff;
  x[i+1] = (u.hi >> 16) & 0xff;
  x[i+2] = (u.hi >>  8) & 0xff;
  x[i+3] = u.hi & 0xff;
  x[i+4] = (u.lo >> 24)  & 0xff;
  x[i+5] = (u.lo >> 16)  & 0xff;
  x[i+6] = (u.lo >>  8)  & 0xff;
  x[i+7] = u.lo & 0xff;
}

function vn(x, xi, y, yi, n) {
  var i,d = 0;
  for (i = 0; i < n; i++) d |= x[xi+i]^y[yi+i];
  return (1 & ((d - 1) >>> 8)) - 1;
}

function crypto_verify_16(x, xi, y, yi) {
  return vn(x,xi,y,yi,16);
}

function crypto_verify_32(x, xi, y, yi) {
  return vn(x,xi,y,yi,32);
}

function core(out,inp,k,c,h) {
  var w = new Uint32Array(16), x = new Uint32Array(16),
      y = new Uint32Array(16), t = new Uint32Array(4);
  var i, j, m;

  for (i = 0; i < 4; i++) {
    x[5*i] = ld32(c, 4*i);
    x[1+i] = ld32(k, 4*i);
    x[6+i] = ld32(inp, 4*i);
    x[11+i] = ld32(k, 16+4*i);
  }

  for (i = 0; i < 16; i++) y[i] = x[i];

  for (i = 0; i < 20; i++) {
    for (j = 0; j < 4; j++) {
      for (m = 0; m < 4; m++) t[m] = x[(5*j+4*m)%16];
      t[1] ^= L32((t[0]+t[3])|0, 7);
      t[2] ^= L32((t[1]+t[0])|0, 9);
      t[3] ^= L32((t[2]+t[1])|0,13);
      t[0] ^= L32((t[3]+t[2])|0,18);
      for (m = 0; m < 4; m++) w[4*j+(j+m)%4] = t[m];
    }
    for (m = 0; m < 16; m++) x[m] = w[m];
  }

  if (h) {
    for (i = 0; i < 16; i++) x[i] = (x[i] + y[i]) | 0;
    for (i = 0; i < 4; i++) {
      x[5*i] = (x[5*i] - ld32(c, 4*i)) | 0;
      x[6+i] = (x[6+i] - ld32(inp, 4*i)) | 0;
    }
    for (i = 0; i < 4; i++) {
      st32(out,4*i,x[5*i]);
      st32(out,16+4*i,x[6+i]);
    }
  } else {
    for (i = 0; i < 16; i++) st32(out, 4 * i, (x[i] + y[i]) | 0);
  }
}

function crypto_core_salsa20(out,inp,k,c) {
  core(out,inp,k,c,false);
  return 0;
}

function crypto_core_hsalsa20(out,inp,k,c) {
  core(out,inp,k,c,true);
  return 0;
}

var sigma = new Uint8Array([101, 120, 112, 97, 110, 100, 32, 51, 50, 45, 98, 121, 116, 101, 32, 107]);
            // "expand 32-byte k"

function crypto_stream_salsa20_xor(c,cpos,m,mpos,b,n,k) {
  var z = new Uint8Array(16), x = new Uint8Array(64);
  var u, i;
  if (!b) return 0;
  for (i = 0; i < 16; i++) z[i] = 0;
  for (i = 0; i < 8; i++) z[i] = n[i];
  while (b >= 64) {
    crypto_core_salsa20(x,z,k,sigma);
    for (i = 0; i < 64; i++) c[cpos+i] = (m?m[mpos+i]:0) ^ x[i];
    u = 1;
    for (i = 8; i < 16; i++) {
      u = u + (z[i] & 0xff) | 0;
      z[i] = u & 0xff;
      u >>>= 8;
    }
    b -= 64;
    cpos += 64;
    if (m) mpos += 64;
  }
  if (b > 0) {
    crypto_core_salsa20(x,z,k,sigma);
    for (i = 0; i < b; i++) c[cpos+i] = (m?m[mpos+i]:0) ^ x[i];
  }
  return 0;
}

function crypto_stream_salsa20(c,cpos,d,n,k) {
  return crypto_stream_salsa20_xor(c,cpos,null,0,d,n,k);
}

function crypto_stream(c,cpos,d,n,k) {
  var s = new Uint8Array(32);
  crypto_core_hsalsa20(s,n,k,sigma);
  return crypto_stream_salsa20(c,cpos,d,n.subarray(16),s);
}

function crypto_stream_xor(c,cpos,m,mpos,d,n,k) {
  var s = new Uint8Array(32);
  crypto_core_hsalsa20(s,n,k,sigma);
  return crypto_stream_salsa20_xor(c,cpos,m,mpos,d,n.subarray(16),s);
}

function add1305(h, c) {
  var j, u = 0;
  for (j = 0; j < 17; j++) {
    u = (u + ((h[j] + c[j]) | 0)) | 0;
    h[j] = u & 255;
    u >>>= 8;
  }
}

var minusp = new Uint32Array([
  5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 252
]);

function crypto_onetimeauth(out, outpos, m, mpos, n, k) {
  var s, i, j, u;
  var x = new Uint32Array(17), r = new Uint32Array(17),
      h = new Uint32Array(17), c = new Uint32Array(17),
      g = new Uint32Array(17);
  for (j = 0; j < 17; j++) r[j]=h[j]=0;
  for (j = 0; j < 16; j++) r[j]=k[j];
  r[3]&=15;
  r[4]&=252;
  r[7]&=15;
  r[8]&=252;
  r[11]&=15;
  r[12]&=252;
  r[15]&=15;

  while (n > 0) {
    for (j = 0; j < 17; j++) c[j] = 0;
    for (j = 0; (j < 16) && (j < n); ++j) c[j] = m[mpos+j];
    c[j] = 1;
    mpos += j; n -= j;
    add1305(h,c);
    for (i = 0; i < 17; i++) {
      x[i] = 0;
      for (j = 0; j < 17; j++) x[i] = (x[i] + (h[j] * ((j <= i) ? r[i - j] : ((320 * r[i + 17 - j])|0))) | 0) | 0;
    }
    for (i = 0; i < 17; i++) h[i] = x[i];
    u = 0;
    for (j = 0; j < 16; j++) {
      u = (u + h[j]) | 0;
      h[j] = u & 255;
      u >>>= 8;
    }
    u = (u + h[16]) | 0; h[16] = u & 3;
    u = (5 * (u >>> 2)) | 0;
    for (j = 0; j < 16; j++) {
      u = (u + h[j]) | 0;
      h[j] = u & 255;
      u >>>= 8;
    }
    u = (u + h[16]) | 0; h[16] = u;
  }

  for (j = 0; j < 17; j++) g[j] = h[j];
  add1305(h,minusp);
  s = (-(h[16] >>> 7) | 0);
  for (j = 0; j < 17; j++) h[j] ^= s & (g[j] ^ h[j]);

  for (j = 0; j < 16; j++) c[j] = k[j + 16];
  c[16] = 0;
  add1305(h,c);
  for (j = 0; j < 16; j++) out[outpos+j] = h[j];
  return 0;
}

function crypto_onetimeauth_verify(h, hpos, m, mpos, n, k) {
  var x = new Uint8Array(16);
  crypto_onetimeauth(x,0,m,mpos,n,k);
  return crypto_verify_16(h,hpos,x,0);
}

function crypto_secretbox(c,m,d,n,k) {
  var i;
  if (d < 32) return -1;
  crypto_stream_xor(c,0,m,0,d,n,k);
  crypto_onetimeauth(c, 16, c, 32, d - 32, c);
  for (i = 0; i < 16; i++) c[i] = 0;
  return 0;
}

function crypto_secretbox_open(m,c,d,n,k) {
  var i;
  var x = new Uint8Array(32);
  if (d < 32) return -1;
  crypto_stream(x,0,32,n,k);
  if (crypto_onetimeauth_verify(c, 16,c, 32,d - 32,x) !== 0) return -1;
  crypto_stream_xor(m,0,c,0,d,n,k);
  for (i = 0; i < 32; i++) m[i] = 0;
  return 0;
}

function set25519(r, a) {
  var i;
  for (i = 0; i < 16; i++) r[i] = a[i]|0;
}

function car25519(o) {
  var c;
  var i;
  for (i = 0; i < 16; i++) {
      o[i] += 65536;
      c = Math.floor(o[i] / 65536);
      o[(i+1)*(i<15?1:0)] += c - 1 + 37 * (c-1) * (i===15?1:0);
      o[i] -= (c * 65536);
  }
}

function sel25519(p, q, b) {
  var t, c = ~(b-1);
  for (var i = 0; i < 16; i++) {
    t = c & (p[i] ^ q[i]);
    p[i] ^= t;
    q[i] ^= t;
  }
}

function pack25519(o, n) {
  var i, j, b;
  var m = gf(), t = gf();
  for (i = 0; i < 16; i++) t[i] = n[i];
  car25519(t);
  car25519(t);
  car25519(t);
  for (j = 0; j < 2; j++) {
    m[0] = t[0] - 0xffed;
    for (i = 1; i < 15; i++) {
      m[i] = t[i] - 0xffff - ((m[i-1]>>16) & 1);
      m[i-1] &= 0xffff;
    }
    m[15] = t[15] - 0x7fff - ((m[14]>>16) & 1);
    b = (m[15]>>16) & 1;
    m[14] &= 0xffff;
    sel25519(t, m, 1-b);
  }
  for (i = 0; i < 16; i++) {
    o[2*i] = t[i] & 0xff;
    o[2*i+1] = t[i]>>8;
  }
}

function neq25519(a, b) {
  var c = new Uint8Array(32), d = new Uint8Array(32);
  pack25519(c, a);
  pack25519(d, b);
  return crypto_verify_32(c, 0, d, 0);
}

function par25519(a) {
  var d = new Uint8Array(32);
  pack25519(d, a);
  return d[0] & 1;
}

function unpack25519(o, n) {
  var i;
  for (i = 0; i < 16; i++) o[i] = n[2*i] + (n[2*i+1] << 8);
  o[15] &= 0x7fff;
}

function A(o, a, b) {
  var i;
  for (i = 0; i < 16; i++) o[i] = (a[i] + b[i])|0;
}

function Z(o, a, b) {
  var i;
  for (i = 0; i < 16; i++) o[i] = (a[i] - b[i])|0;
}

function M(o, a, b) {
  var i, j, t = new Float64Array(31);
  for (i = 0; i < 31; i++) t[i] = 0;
  for (i = 0; i < 16; i++) {
    for (j = 0; j < 16; j++) {
      t[i+j] += a[i] * b[j];
    }
  }
  for (i = 0; i < 15; i++) {
    t[i] += 38 * t[i+16];
  }
  for (i = 0; i < 16; i++) o[i] = t[i];
  car25519(o);
  car25519(o);
}

function S(o, a) {
  M(o, a, a);
}

function inv25519(o, i) {
  var c = gf();
  var a;
  for (a = 0; a < 16; a++) c[a] = i[a];
  for (a = 253; a >= 0; a--) {
    S(c, c);
    if(a !== 2 && a !== 4) M(c, c, i);
  }
  for (a = 0; a < 16; a++) o[a] = c[a];
}

function pow2523(o, i) {
  var c = gf();
  var a;
  for (a = 0; a < 16; a++) c[a] = i[a];
  for (a = 250; a >= 0; a--) {
      S(c, c);
      if(a !== 1) M(c, c, i);
  }
  for (a = 0; a < 16; a++) o[a] = c[a];
}

function crypto_scalarmult(q, n, p) {
  var z = new Uint8Array(32);
  var x = new Float64Array(80), r, i;
  var a = gf(), b = gf(), c = gf(),
      d = gf(), e = gf(), f = gf();
  for (i = 0; i < 31; i++) z[i] = n[i];
  z[31]=(n[31]&127)|64;
  z[0]&=248;
  unpack25519(x,p);
  for (i = 0; i < 16; i++) {
    b[i]=x[i];
    d[i]=a[i]=c[i]=0;
  }
  a[0]=d[0]=1;
  for (i=254; i>=0; --i) {
    r=(z[i>>>3]>>>(i&7))&1;
    sel25519(a,b,r);
    sel25519(c,d,r);
    A(e,a,c);
    Z(a,a,c);
    A(c,b,d);
    Z(b,b,d);
    S(d,e);
    S(f,a);
    M(a,c,a);
    M(c,b,e);
    A(e,a,c);
    Z(a,a,c);
    S(b,a);
    Z(c,d,f);
    M(a,c,_121665);
    A(a,a,d);
    M(c,c,a);
    M(a,d,f);
    M(d,b,x);
    S(b,e);
    sel25519(a,b,r);
    sel25519(c,d,r);
  }
  for (i = 0; i < 16; i++) {
    x[i+16]=a[i];
    x[i+32]=c[i];
    x[i+48]=b[i];
    x[i+64]=d[i];
  }
  var x32 = x.subarray(32);
  var x16 = x.subarray(16);
  inv25519(x32,x32);
  M(x16,x16,x32);
  pack25519(q,x16);
  return 0;
}

function crypto_scalarmult_base(q, n) {
  return crypto_scalarmult(q, n, _9);
}

function crypto_box_keypair(y, x) {
  randombytes(x, 32);
  return crypto_scalarmult_base(y, x);
}

function crypto_box_beforenm(k, y, x) {
  var s = new Uint8Array(32);
  crypto_scalarmult(s, x, y);
  return crypto_core_hsalsa20(k, _0, s, sigma);
}

var crypto_box_afternm = crypto_secretbox;
var crypto_box_open_afternm = crypto_secretbox_open;

function crypto_box(c, m, d, n, y, x) {
  var k = new Uint8Array(32);
  crypto_box_beforenm(k, y, x);
  return crypto_box_afternm(c, m, d, n, k);
}

function crypto_box_open(m, c, d, n, y, x) {
  var k = new Uint8Array(32);
  crypto_box_beforenm(k, y, x);
  return crypto_box_open_afternm(m, c, d, n, k);
}

function add64() {
  var a = 0, b = 0, c = 0, d = 0, m16 = 65535, l, h, i;
  for (i = 0; i < arguments.length; i++) {
    l = arguments[i].lo;
    h = arguments[i].hi;
    a += (l & m16); b += (l >>> 16);
    c += (h & m16); d += (h >>> 16);
  }

  b += (a >>> 16);
  c += (b >>> 16);
  d += (c >>> 16);

  return new u64((c & m16) | (d << 16), (a & m16) | (b << 16));
}

function shr64(x, c) {
  return new u64((x.hi >>> c), (x.lo >>> c) | (x.hi << (32 - c)));
}

function xor64() {
  var l = 0, h = 0, i;
  for (i = 0; i < arguments.length; i++) {
    l ^= arguments[i].lo;
    h ^= arguments[i].hi;
  }
  return new u64(h, l);
}

function R(x, c) {
  var h, l, c1 = 32 - c;
  if (c < 32) {
    h = (x.hi >>> c) | (x.lo << c1);
    l = (x.lo >>> c) | (x.hi << c1);
  } else if (c < 64) {
    h = (x.lo >>> c) | (x.hi << c1);
    l = (x.hi >>> c) | (x.lo << c1);
  }
  return new u64(h, l);
}

function Ch(x, y, z) {
  var h = (x.hi & y.hi) ^ (~x.hi & z.hi),
      l = (x.lo & y.lo) ^ (~x.lo & z.lo);
  return new u64(h, l);
}

function Maj(x, y, z) {
  var h = (x.hi & y.hi) ^ (x.hi & z.hi) ^ (y.hi & z.hi),
      l = (x.lo & y.lo) ^ (x.lo & z.lo) ^ (y.lo & z.lo);
  return new u64(h, l);
}

function Sigma0(x) { return xor64(R(x,28), R(x,34), R(x,39)); }
function Sigma1(x) { return xor64(R(x,14), R(x,18), R(x,41)); }
function sigma0(x) { return xor64(R(x, 1), R(x, 8), shr64(x,7)); }
function sigma1(x) { return xor64(R(x,19), R(x,61), shr64(x,6)); }

var K = [
  new u64(0x428a2f98, 0xd728ae22), new u64(0x71374491, 0x23ef65cd),
  new u64(0xb5c0fbcf, 0xec4d3b2f), new u64(0xe9b5dba5, 0x8189dbbc),
  new u64(0x3956c25b, 0xf348b538), new u64(0x59f111f1, 0xb605d019),
  new u64(0x923f82a4, 0xaf194f9b), new u64(0xab1c5ed5, 0xda6d8118),
  new u64(0xd807aa98, 0xa3030242), new u64(0x12835b01, 0x45706fbe),
  new u64(0x243185be, 0x4ee4b28c), new u64(0x550c7dc3, 0xd5ffb4e2),
  new u64(0x72be5d74, 0xf27b896f), new u64(0x80deb1fe, 0x3b1696b1),
  new u64(0x9bdc06a7, 0x25c71235), new u64(0xc19bf174, 0xcf692694),
  new u64(0xe49b69c1, 0x9ef14ad2), new u64(0xefbe4786, 0x384f25e3),
  new u64(0x0fc19dc6, 0x8b8cd5b5), new u64(0x240ca1cc, 0x77ac9c65),
  new u64(0x2de92c6f, 0x592b0275), new u64(0x4a7484aa, 0x6ea6e483),
  new u64(0x5cb0a9dc, 0xbd41fbd4), new u64(0x76f988da, 0x831153b5),
  new u64(0x983e5152, 0xee66dfab), new u64(0xa831c66d, 0x2db43210),
  new u64(0xb00327c8, 0x98fb213f), new u64(0xbf597fc7, 0xbeef0ee4),
  new u64(0xc6e00bf3, 0x3da88fc2), new u64(0xd5a79147, 0x930aa725),
  new u64(0x06ca6351, 0xe003826f), new u64(0x14292967, 0x0a0e6e70),
  new u64(0x27b70a85, 0x46d22ffc), new u64(0x2e1b2138, 0x5c26c926),
  new u64(0x4d2c6dfc, 0x5ac42aed), new u64(0x53380d13, 0x9d95b3df),
  new u64(0x650a7354, 0x8baf63de), new u64(0x766a0abb, 0x3c77b2a8),
  new u64(0x81c2c92e, 0x47edaee6), new u64(0x92722c85, 0x1482353b),
  new u64(0xa2bfe8a1, 0x4cf10364), new u64(0xa81a664b, 0xbc423001),
  new u64(0xc24b8b70, 0xd0f89791), new u64(0xc76c51a3, 0x0654be30),
  new u64(0xd192e819, 0xd6ef5218), new u64(0xd6990624, 0x5565a910),
  new u64(0xf40e3585, 0x5771202a), new u64(0x106aa070, 0x32bbd1b8),
  new u64(0x19a4c116, 0xb8d2d0c8), new u64(0x1e376c08, 0x5141ab53),
  new u64(0x2748774c, 0xdf8eeb99), new u64(0x34b0bcb5, 0xe19b48a8),
  new u64(0x391c0cb3, 0xc5c95a63), new u64(0x4ed8aa4a, 0xe3418acb),
  new u64(0x5b9cca4f, 0x7763e373), new u64(0x682e6ff3, 0xd6b2b8a3),
  new u64(0x748f82ee, 0x5defb2fc), new u64(0x78a5636f, 0x43172f60),
  new u64(0x84c87814, 0xa1f0ab72), new u64(0x8cc70208, 0x1a6439ec),
  new u64(0x90befffa, 0x23631e28), new u64(0xa4506ceb, 0xde82bde9),
  new u64(0xbef9a3f7, 0xb2c67915), new u64(0xc67178f2, 0xe372532b),
  new u64(0xca273ece, 0xea26619c), new u64(0xd186b8c7, 0x21c0c207),
  new u64(0xeada7dd6, 0xcde0eb1e), new u64(0xf57d4f7f, 0xee6ed178),
  new u64(0x06f067aa, 0x72176fba), new u64(0x0a637dc5, 0xa2c898a6),
  new u64(0x113f9804, 0xbef90dae), new u64(0x1b710b35, 0x131c471b),
  new u64(0x28db77f5, 0x23047d84), new u64(0x32caab7b, 0x40c72493),
  new u64(0x3c9ebe0a, 0x15c9bebc), new u64(0x431d67c4, 0x9c100d4c),
  new u64(0x4cc5d4be, 0xcb3e42b6), new u64(0x597f299c, 0xfc657e2a),
  new u64(0x5fcb6fab, 0x3ad6faec), new u64(0x6c44198c, 0x4a475817)
];

function crypto_hashblocks(x, m, n) {
  var z = [], b = [], a = [], w = [], t, i, j;

  for (i = 0; i < 8; i++) z[i] = a[i] = dl64(x, 8*i);

  var pos = 0;
  while (n >= 128) {
    for (i = 0; i < 16; i++) w[i] = dl64(m, 8*i+pos);
    for (i = 0; i < 80; i++) {
      for (j = 0; j < 8; j++) b[j] = a[j];
      t = add64(a[7], Sigma1(a[4]), Ch(a[4], a[5], a[6]), K[i], w[i%16]);
      b[7] = add64(t, Sigma0(a[0]), Maj(a[0], a[1], a[2]));
      b[3] = add64(b[3], t);
      for (j = 0; j < 8; j++) a[(j+1)%8] = b[j];
      if (i%16 === 15) {
        for (j = 0; j < 16; j++) {
          w[j] = add64(w[j], w[(j+9)%16], sigma0(w[(j+1)%16]), sigma1(w[(j+14)%16]));
        }
      }
    }

    for (i = 0; i < 8; i++) {
      a[i] = add64(a[i], z[i]);
      z[i] = a[i];
    }

    pos += 128;
    n -= 128;
  }

  for (i = 0; i < 8; i++) ts64(x, 8*i, z[i]);
  return n;
}

var iv = new Uint8Array([
  0x6a,0x09,0xe6,0x67,0xf3,0xbc,0xc9,0x08,
  0xbb,0x67,0xae,0x85,0x84,0xca,0xa7,0x3b,
  0x3c,0x6e,0xf3,0x72,0xfe,0x94,0xf8,0x2b,
  0xa5,0x4f,0xf5,0x3a,0x5f,0x1d,0x36,0xf1,
  0x51,0x0e,0x52,0x7f,0xad,0xe6,0x82,0xd1,
  0x9b,0x05,0x68,0x8c,0x2b,0x3e,0x6c,0x1f,
  0x1f,0x83,0xd9,0xab,0xfb,0x41,0xbd,0x6b,
  0x5b,0xe0,0xcd,0x19,0x13,0x7e,0x21,0x79
]);

function crypto_hash(out, m, n) {
  var h = new Uint8Array(64), x = new Uint8Array(256);
  var i, b = n;

  for (i = 0; i < 64; i++) h[i] = iv[i];

  crypto_hashblocks(h, m, n);
  n %= 128;

  for (i = 0; i < 256; i++) x[i] = 0;
  for (i = 0; i < n; i++) x[i] = m[b-n+i];
  x[n] = 128;

  n = 256-128*(n<112?1:0);
  x[n-9] = 0;
  ts64(x, n-8, new u64((b / 0x20000000) | 0, b << 3));
  crypto_hashblocks(h, x, n);

  for (i = 0; i < 64; i++) out[i] = h[i];

  return 0;
}

function add(p, q) {
  var a = gf(), b = gf(), c = gf(),
      d = gf(), e = gf(), f = gf(),
      g = gf(), h = gf(), t = gf();

  Z(a, p[1], p[0]);
  Z(t, q[1], q[0]);
  M(a, a, t);
  A(b, p[0], p[1]);
  A(t, q[0], q[1]);
  M(b, b, t);
  M(c, p[3], q[3]);
  M(c, c, D2);
  M(d, p[2], q[2]);
  A(d, d, d);
  Z(e, b, a);
  Z(f, d, c);
  A(g, d, c);
  A(h, b, a);

  M(p[0], e, f);
  M(p[1], h, g);
  M(p[2], g, f);
  M(p[3], e, h);
}

function cswap(p, q, b) {
  var i;
  for (i = 0; i < 4; i++) {
    sel25519(p[i], q[i], b);
  }
}

function pack(r, p) {
  var tx = gf(), ty = gf(), zi = gf();
  inv25519(zi, p[2]);
  M(tx, p[0], zi);
  M(ty, p[1], zi);
  pack25519(r, ty);
  r[31] ^= par25519(tx) << 7;
}

function scalarmult(p, q, s) {
  var b, i;
  set25519(p[0], gf0);
  set25519(p[1], gf1);
  set25519(p[2], gf1);
  set25519(p[3], gf0);
  for (i = 255; i >= 0; --i) {
    b = (s[(i/8)|0] >> (i&7)) & 1;
    cswap(p, q, b);
    add(q, p);
    add(p, p);
    cswap(p, q, b);
  }
}

function scalarbase(p, s) {
  var q = [gf(), gf(), gf(), gf()];
  set25519(q[0], X);
  set25519(q[1], Y);
  set25519(q[2], gf1);
  M(q[3], X, Y);
  scalarmult(p, q, s);
}

function crypto_sign_keypair(pk, sk, seeded) {
  var d = new Uint8Array(64);
  var p = [gf(), gf(), gf(), gf()];
  var i;

  if (!seeded) randombytes(sk, 32);
  crypto_hash(d, sk, 32);
  d[0] &= 248;
  d[31] &= 127;
  d[31] |= 64;

  scalarbase(p, d);
  pack(pk, p);

  for (i = 0; i < 32; i++) sk[i+32] = pk[i];
  return 0;
}

var L = new Float64Array([0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10]);

function modL(r, x) {
  var carry, i, j, k;
  for (i = 63; i >= 32; --i) {
    carry = 0;
    for (j = i - 32, k = i - 12; j < k; ++j) {
      x[j] += carry - 16 * x[i] * L[j - (i - 32)];
      carry = Math.floor((x[j] + 128) / 256);
      x[j] -= carry * 256;
    }
    x[j] += carry;
    x[i] = 0;
  }
  carry = 0;
  for (j = 0; j < 32; j++) {
    x[j] += carry - (x[31] >> 4) * L[j];
    carry = x[j] >> 8;
    x[j] &= 255;
  }
  for (j = 0; j < 32; j++) x[j] -= carry * L[j];
  for (i = 0; i < 32; i++) {
    x[i+1] += x[i] >> 8;
    r[i] = x[i] & 255;
  }
}

function reduce(r) {
  var x = new Float64Array(64), i;
  for (i = 0; i < 64; i++) x[i] = r[i];
  for (i = 0; i < 64; i++) r[i] = 0;
  modL(r, x);
}

// Note: difference from C - smlen returned, not passed as argument.
function crypto_sign(sm, m, n, sk) {
  var d = new Uint8Array(64), h = new Uint8Array(64), r = new Uint8Array(64);
  var i, j, x = new Float64Array(64);
  var p = [gf(), gf(), gf(), gf()];

  crypto_hash(d, sk, 32);
  d[0] &= 248;
  d[31] &= 127;
  d[31] |= 64;

  var smlen = n + 64;
  for (i = 0; i < n; i++) sm[64 + i] = m[i];
  for (i = 0; i < 32; i++) sm[32 + i] = d[32 + i];

  crypto_hash(r, sm.subarray(32), n+32);
  reduce(r);
  scalarbase(p, r);
  pack(sm, p);

  for (i = 32; i < 64; i++) sm[i] = sk[i];
  crypto_hash(h, sm, n + 64);
  reduce(h);

  for (i = 0; i < 64; i++) x[i] = 0;
  for (i = 0; i < 32; i++) x[i] = r[i];
  for (i = 0; i < 32; i++) {
    for (j = 0; j < 32; j++) {
      x[i+j] += h[i] * d[j];
    }
  }

  modL(sm.subarray(32), x);
  return smlen;
}

function unpackneg(r, p) {
  var t = gf(), chk = gf(), num = gf(),
      den = gf(), den2 = gf(), den4 = gf(),
      den6 = gf();

  set25519(r[2], gf1);
  unpack25519(r[1], p);
  S(num, r[1]);
  M(den, num, D);
  Z(num, num, r[2]);
  A(den, r[2], den);

  S(den2, den);
  S(den4, den2);
  M(den6, den4, den2);
  M(t, den6, num);
  M(t, t, den);

  pow2523(t, t);
  M(t, t, num);
  M(t, t, den);
  M(t, t, den);
  M(r[0], t, den);

  S(chk, r[0]);
  M(chk, chk, den);
  if (neq25519(chk, num)) M(r[0], r[0], I);

  S(chk, r[0]);
  M(chk, chk, den);
  if (neq25519(chk, num)) return -1;

  if (par25519(r[0]) === (p[31]>>7)) Z(r[0], gf0, r[0]);

  M(r[3], r[0], r[1]);
  return 0;
}

function crypto_sign_open(m, sm, n, pk) {
  var i;
  var t = new Uint8Array(32), h = new Uint8Array(64);
  var p = [gf(), gf(), gf(), gf()],
      q = [gf(), gf(), gf(), gf()];

  if (n < 64) return -1;

  if (unpackneg(q, pk)) return -1;

  for (i = 0; i < n; i++) m[i] = sm[i];
  for (i = 0; i < 32; i++) m[i+32] = pk[i];
  crypto_hash(h, m, n);
  reduce(h);
  scalarmult(p, q, h);

  scalarbase(q, sm.subarray(32));
  add(p, q);
  pack(t, p);

  n -= 64;
  if (crypto_verify_32(sm, 0, t, 0)) {
    for (i = 0; i < n; i++) m[i] = 0;
    return -1;
  }

  for (i = 0; i < n; i++) m[i] = sm[i + 64];
  return n;
}

var crypto_secretbox_KEYBYTES = 32,
    crypto_secretbox_NONCEBYTES = 24,
    crypto_secretbox_ZEROBYTES = 32,
    crypto_secretbox_BOXZEROBYTES = 16,
    crypto_scalarmult_BYTES = 32,
    crypto_scalarmult_SCALARBYTES = 32,
    crypto_box_PUBLICKEYBYTES = 32,
    crypto_box_SECRETKEYBYTES = 32,
    crypto_box_BEFORENMBYTES = 32,
    crypto_box_NONCEBYTES = crypto_secretbox_NONCEBYTES,
    crypto_box_ZEROBYTES = crypto_secretbox_ZEROBYTES,
    crypto_box_BOXZEROBYTES = crypto_secretbox_BOXZEROBYTES,
    crypto_sign_BYTES = 64,
    crypto_sign_PUBLICKEYBYTES = 32,
    crypto_sign_SECRETKEYBYTES = 64,
    crypto_sign_SEEDBYTES = 32,
    crypto_hash_BYTES = 64;

nacl.lowlevel = {
  crypto_core_hsalsa20: crypto_core_hsalsa20,
  crypto_stream_xor: crypto_stream_xor,
  crypto_stream: crypto_stream,
  crypto_stream_salsa20_xor: crypto_stream_salsa20_xor,
  crypto_stream_salsa20: crypto_stream_salsa20,
  crypto_onetimeauth: crypto_onetimeauth,
  crypto_onetimeauth_verify: crypto_onetimeauth_verify,
  crypto_verify_16: crypto_verify_16,
  crypto_verify_32: crypto_verify_32,
  crypto_secretbox: crypto_secretbox,
  crypto_secretbox_open: crypto_secretbox_open,
  crypto_scalarmult: crypto_scalarmult,
  crypto_scalarmult_base: crypto_scalarmult_base,
  crypto_box_beforenm: crypto_box_beforenm,
  crypto_box_afternm: crypto_box_afternm,
  crypto_box: crypto_box,
  crypto_box_open: crypto_box_open,
  crypto_box_keypair: crypto_box_keypair,
  crypto_hash: crypto_hash,
  crypto_sign: crypto_sign,
  crypto_sign_keypair: crypto_sign_keypair,
  crypto_sign_open: crypto_sign_open,

  crypto_secretbox_KEYBYTES: crypto_secretbox_KEYBYTES,
  crypto_secretbox_NONCEBYTES: crypto_secretbox_NONCEBYTES,
  crypto_secretbox_ZEROBYTES: crypto_secretbox_ZEROBYTES,
  crypto_secretbox_BOXZEROBYTES: crypto_secretbox_BOXZEROBYTES,
  crypto_scalarmult_BYTES: crypto_scalarmult_BYTES,
  crypto_scalarmult_SCALARBYTES: crypto_scalarmult_SCALARBYTES,
  crypto_box_PUBLICKEYBYTES: crypto_box_PUBLICKEYBYTES,
  crypto_box_SECRETKEYBYTES: crypto_box_SECRETKEYBYTES,
  crypto_box_BEFORENMBYTES: crypto_box_BEFORENMBYTES,
  crypto_box_NONCEBYTES: crypto_box_NONCEBYTES,
  crypto_box_ZEROBYTES: crypto_box_ZEROBYTES,
  crypto_box_BOXZEROBYTES: crypto_box_BOXZEROBYTES,
  crypto_sign_BYTES: crypto_sign_BYTES,
  crypto_sign_PUBLICKEYBYTES: crypto_sign_PUBLICKEYBYTES,
  crypto_sign_SECRETKEYBYTES: crypto_sign_SECRETKEYBYTES,
  crypto_sign_SEEDBYTES: crypto_sign_SEEDBYTES,
  crypto_hash_BYTES: crypto_hash_BYTES,

  gf: gf,
  D: D,
  L: L,
  pack25519: pack25519,
  unpack25519: unpack25519,
  M: M,
  A: A,
  S: S,
  Z: Z,
  pow2523: pow2523,
  add: add,
  set25519: set25519,
  modL: modL,
  scalarmult: scalarmult,
  scalarbase: scalarbase,
};

/* High-level API */

function checkLengths(k, n) {
  if (k.length !== crypto_secretbox_KEYBYTES) throw new Error('bad key size');
  if (n.length !== crypto_secretbox_NONCEBYTES) throw new Error('bad nonce size');
}

function checkBoxLengths(pk, sk) {
  if (pk.length !== crypto_box_PUBLICKEYBYTES) throw new Error('bad public key size');
  if (sk.length !== crypto_box_SECRETKEYBYTES) throw new Error('bad secret key size');
}

function checkArrayTypes() {
  for (var i = 0; i < arguments.length; i++) {
    if (!(arguments[i] instanceof Uint8Array))
      throw new TypeError('unexpected type, use Uint8Array');
  }
}

function cleanup(arr) {
  for (var i = 0; i < arr.length; i++) arr[i] = 0;
}

nacl.randomBytes = function(n) {
  var b = new Uint8Array(n);
  randombytes(b, n);
  return b;
};

nacl.secretbox = function(msg, nonce, key) {
  checkArrayTypes(msg, nonce, key);
  checkLengths(key, nonce);
  var m = new Uint8Array(crypto_secretbox_ZEROBYTES + msg.length);
  var c = new Uint8Array(m.length);
  for (var i = 0; i < msg.length; i++) m[i+crypto_secretbox_ZEROBYTES] = msg[i];
  crypto_secretbox(c, m, m.length, nonce, key);
  return c.subarray(crypto_secretbox_BOXZEROBYTES);
};

nacl.secretbox.open = function(box, nonce, key) {
  checkArrayTypes(box, nonce, key);
  checkLengths(key, nonce);
  var c = new Uint8Array(crypto_secretbox_BOXZEROBYTES + box.length);
  var m = new Uint8Array(c.length);
  for (var i = 0; i < box.length; i++) c[i+crypto_secretbox_BOXZEROBYTES] = box[i];
  if (c.length < 32) return null;
  if (crypto_secretbox_open(m, c, c.length, nonce, key) !== 0) return null;
  return m.subarray(crypto_secretbox_ZEROBYTES);
};

nacl.secretbox.keyLength = crypto_secretbox_KEYBYTES;
nacl.secretbox.nonceLength = crypto_secretbox_NONCEBYTES;
nacl.secretbox.overheadLength = crypto_secretbox_BOXZEROBYTES;

nacl.scalarMult = function(n, p) {
  checkArrayTypes(n, p);
  if (n.length !== crypto_scalarmult_SCALARBYTES) throw new Error('bad n size');
  if (p.length !== crypto_scalarmult_BYTES) throw new Error('bad p size');
  var q = new Uint8Array(crypto_scalarmult_BYTES);
  crypto_scalarmult(q, n, p);
  return q;
};

nacl.scalarMult.base = function(n) {
  checkArrayTypes(n);
  if (n.length !== crypto_scalarmult_SCALARBYTES) throw new Error('bad n size');
  var q = new Uint8Array(crypto_scalarmult_BYTES);
  crypto_scalarmult_base(q, n);
  return q;
};

nacl.scalarMult.scalarLength = crypto_scalarmult_SCALARBYTES;
nacl.scalarMult.groupElementLength = crypto_scalarmult_BYTES;

nacl.box = function(msg, nonce, publicKey, secretKey) {
  var k = nacl.box.before(publicKey, secretKey);
  return nacl.secretbox(msg, nonce, k);
};

nacl.box.before = function(publicKey, secretKey) {
  checkArrayTypes(publicKey, secretKey);
  checkBoxLengths(publicKey, secretKey);
  var k = new Uint8Array(crypto_box_BEFORENMBYTES);
  crypto_box_beforenm(k, publicKey, secretKey);
  return k;
};

nacl.box.after = nacl.secretbox;

nacl.box.open = function(msg, nonce, publicKey, secretKey) {
  var k = nacl.box.before(publicKey, secretKey);
  return nacl.secretbox.open(msg, nonce, k);
};

nacl.box.open.after = nacl.secretbox.open;

nacl.box.keyPair = function() {
  var pk = new Uint8Array(crypto_box_PUBLICKEYBYTES);
  var sk = new Uint8Array(crypto_box_SECRETKEYBYTES);
  crypto_box_keypair(pk, sk);
  return {publicKey: pk, secretKey: sk};
};

nacl.box.keyPair.fromSecretKey = function(secretKey) {
  checkArrayTypes(secretKey);
  if (secretKey.length !== crypto_box_SECRETKEYBYTES)
    throw new Error('bad secret key size');
  var pk = new Uint8Array(crypto_box_PUBLICKEYBYTES);
  crypto_scalarmult_base(pk, secretKey);
  return {publicKey: pk, secretKey: new Uint8Array(secretKey)};
};

nacl.box.publicKeyLength = crypto_box_PUBLICKEYBYTES;
nacl.box.secretKeyLength = crypto_box_SECRETKEYBYTES;
nacl.box.sharedKeyLength = crypto_box_BEFORENMBYTES;
nacl.box.nonceLength = crypto_box_NONCEBYTES;
nacl.box.overheadLength = nacl.secretbox.overheadLength;

nacl.sign = function(msg, secretKey) {
  checkArrayTypes(msg, secretKey);
  if (secretKey.length !== crypto_sign_SECRETKEYBYTES)
    throw new Error('bad secret key size');
  var signedMsg = new Uint8Array(crypto_sign_BYTES+msg.length);
  crypto_sign(signedMsg, msg, msg.length, secretKey);
  return signedMsg;
};

nacl.sign.open = function(signedMsg, publicKey) {
  checkArrayTypes(signedMsg, publicKey);
  if (publicKey.length !== crypto_sign_PUBLICKEYBYTES)
    throw new Error('bad public key size');
  var tmp = new Uint8Array(signedMsg.length);
  var mlen = crypto_sign_open(tmp, signedMsg, signedMsg.length, publicKey);
  if (mlen < 0) return null;
  var m = new Uint8Array(mlen);
  for (var i = 0; i < m.length; i++) m[i] = tmp[i];
  return m;
};

nacl.sign.detached = function(msg, secretKey) {
  var signedMsg = nacl.sign(msg, secretKey);
  var sig = new Uint8Array(crypto_sign_BYTES);
  for (var i = 0; i < sig.length; i++) sig[i] = signedMsg[i];
  return sig;
};

nacl.sign.detached.verify = function(msg, sig, publicKey) {
  checkArrayTypes(msg, sig, publicKey);
  if (sig.length !== crypto_sign_BYTES)
    throw new Error('bad signature size');
  if (publicKey.length !== crypto_sign_PUBLICKEYBYTES)
    throw new Error('bad public key size');
  var sm = new Uint8Array(crypto_sign_BYTES + msg.length);
  var m = new Uint8Array(crypto_sign_BYTES + msg.length);
  var i;
  for (i = 0; i < crypto_sign_BYTES; i++) sm[i] = sig[i];
  for (i = 0; i < msg.length; i++) sm[i+crypto_sign_BYTES] = msg[i];
  return (crypto_sign_open(m, sm, sm.length, publicKey) >= 0);
};

nacl.sign.keyPair = function() {
  var pk = new Uint8Array(crypto_sign_PUBLICKEYBYTES);
  var sk = new Uint8Array(crypto_sign_SECRETKEYBYTES);
  crypto_sign_keypair(pk, sk);
  return {publicKey: pk, secretKey: sk};
};

nacl.sign.keyPair.fromSecretKey = function(secretKey) {
  checkArrayTypes(secretKey);
  if (secretKey.length !== crypto_sign_SECRETKEYBYTES)
    throw new Error('bad secret key size');
  var pk = new Uint8Array(crypto_sign_PUBLICKEYBYTES);
  for (var i = 0; i < pk.length; i++) pk[i] = secretKey[32+i];
  return {publicKey: pk, secretKey: new Uint8Array(secretKey)};
};

nacl.sign.keyPair.fromSeed = function(seed) {
  checkArrayTypes(seed);
  if (seed.length !== crypto_sign_SEEDBYTES)
    throw new Error('bad seed size');
  var pk = new Uint8Array(crypto_sign_PUBLICKEYBYTES);
  var sk = new Uint8Array(crypto_sign_SECRETKEYBYTES);
  for (var i = 0; i < 32; i++) sk[i] = seed[i];
  crypto_sign_keypair(pk, sk, true);
  return {publicKey: pk, secretKey: sk};
};

nacl.sign.publicKeyLength = crypto_sign_PUBLICKEYBYTES;
nacl.sign.secretKeyLength = crypto_sign_SECRETKEYBYTES;
nacl.sign.seedLength = crypto_sign_SEEDBYTES;
nacl.sign.signatureLength = crypto_sign_BYTES;

nacl.hash = function(msg) {
  checkArrayTypes(msg);
  var h = new Uint8Array(crypto_hash_BYTES);
  crypto_hash(h, msg, msg.length);
  return h;
};

nacl.hash.hashLength = crypto_hash_BYTES;

nacl.verify = function(x, y) {
  checkArrayTypes(x, y);
  // Zero length arguments are considered not equal.
  if (x.length === 0 || y.length === 0) return false;
  if (x.length !== y.length) return false;
  return (vn(x, 0, y, 0, x.length) === 0) ? true : false;
};

nacl.setPRNG = function(fn) {
  randombytes = fn;
};

(function() {
  // Initialize PRNG if environment provides CSPRNG.
  // If not, methods calling randombytes will throw.
  var crypto = typeof self !== 'undefined' ? (self.crypto || self.msCrypto) : null;
  if (crypto && crypto.getRandomValues) {
    // Browsers.
    var QUOTA = 65536;
    nacl.setPRNG(function(x, n) {
      var i, v = new Uint8Array(n);
      for (i = 0; i < n; i += QUOTA) {
        crypto.getRandomValues(v.subarray(i, i + Math.min(n - i, QUOTA)));
      }
      for (i = 0; i < n; i++) x[i] = v[i];
      cleanup(v);
    });
  } else if (typeof require !== 'undefined') {
    // Node.js.
    crypto = require('crypto');
    if (crypto && crypto.randomBytes) {
      nacl.setPRNG(function(x, n) {
        var i, v = crypto.randomBytes(n);
        for (i = 0; i < n; i++) x[i] = v[i];
        cleanup(v);
      });
    }
  }
})();

})(typeof module !== 'undefined' && module.exports ? module.exports : (self.nacl = self.nacl || {}));


// Cloudflare Worker —— 成员自助接入。
// 主通道：手机 + 短信验证码登录网易云 → 拿 MUSIC_U。
// 备用通道：成员手动粘贴浏览器里的 MUSIC_U（短信收不到 / 登录失败时用）。
// 两通道都：解析分享链接拿 song id → 用 KV 维护主号池 → 重算分片 → 覆盖写 GitHub Secrets(NB_POOL_1..5)。
// 需要的 CF 环境变量/绑定：
//   GH_TOKEN   有 repo 权限的 GitHub PAT（写 secret 用，仅服务端，不落前端）
//   GH_OWNER   仓库 owner（如 xm921018）
//   GH_REPO    仓库名（如 cron-relay）
//   GROUP_PASS 一群群口令（群内共享的一个暗号，防外人乱加；不是逐人邀请码）
//   ⚠️ 本文件是「定制版」独立 worker（脚本名 dingzhi，地址 dingzhi.listenmusic888.workers.dev），
//      由 worker.js 复制派生：页面显示"定制版"、无群口令、登记固定按二群闸口（POOL_LIMIT_G2）计数。
//      与主 worker 共用同一个 KV 号池（POOL 绑定）。改主 worker.js 逻辑时需手动同步本文件！
//   GROUP_PASS2 二群群口令（可选。二群登记页 /g2 专用，与一群共用同一个 KV 号池；
//               不配置则 /g2 提示"二群登记尚未开放"。两个口令相互独立，互不通用）
//   POOL_LIMIT 旧的单池上限键（已由 POOL_LIMIT_G1 / POOL_LIMIT_G2 取代，保留兼容）
//   POOL_LIMIT_G1 一群登记上限（默认 200）/ POOL_LIMIT_G2 二群登记上限（默认 500）
//   POOL       KV namespace 绑定（维护主号池，cookie 不落 GitHub 仓库文件）
// 注意：cookie 只在 KV 与 GitHub Secrets（加密）中存在，仓库文件无明文。


const BASE = 'https://music.163.com';
const NONCE = '0CoJUm6Qyw8W8jud';
const SECRET = 'TA3YiYCfY2dDJQgg';
const VI = '0102030405060708';
const ENCSEC = '84ca47bca10bad09a6b04c5c927ef077d9b9f1e37098aa3eac6ea70eb59df0aa28b691b7e75e4f1f9831754919ea784c8f74fbfadf2898b0be17849fd656060162857830e241aba44991601f137624094c114ea8d17bce815b0cd4e5b8e2fbaba978c6d1d14dc3d1faf852bdd28818031ccdaaa13a6018e1024e2aae98844210';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

// ---- base64 ----
const b64enc = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8)));
const b64dec = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const utf8 = (s) => new TextEncoder().encode(s);

// ---- AES-CBC (WebCrypto) ----
async function aesCbc(dataU8, keyStr) {
  const key = await crypto.subtle.importKey('raw', utf8(keyStr), { name: 'AES-CBC' }, false, ['encrypt']);
  const n = 16 - dataU8.length % 16;
  const pad = new Uint8Array(dataU8.length + n);
  pad.set(dataU8); pad.fill(n, dataU8.length);
  const ct = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: utf8(VI) }, key, pad);
  return new Uint8Array(ct);
}
// weapi 标准实现（2026-10-10 实测修复）：
//   json → AES(NONCE) → base64 → AES(随机16字符key) → base64 = params
//   encSecKey = RSA(随机key 反转后按 ASCII 转 hex, e=010001) 转 hex 补零到 256 位
// 旧实现漏了中间 base64 且 encSecKey 固定不匹配，导致网易解不开、返回空 200。
const RSA_MODULUS = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';
function modPow(b, e, m) { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
async function weapi(data) {
  const chars = '0123456789abcdef';
  const rnd = [...crypto.getRandomValues(new Uint8Array(16))].map(x => chars[x % 16]).join('');
  let p = await aesCbc(utf8(JSON.stringify(data)), NONCE);
  p = b64enc(p);
  p = await aesCbc(utf8(p), rnd);
  const rev = rnd.split('').reverse().join('');
  const hexOfAscii = [...rev].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  const encSecKey = modPow(BigInt('0x' + hexOfAscii), 0x10001n, BigInt('0x' + RSA_MODULUS)).toString(16).padStart(256, '0');
  return { params: b64enc(p), encSecKey };
}

async function neteaseSendCode(phone) {
  try {
    const body = await weapi({ cellphone: phone, ctcode: '86' });
    const r = await fetch(`${BASE}/weapi/sms/captcha/sent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Referer: BASE + '/', Origin: BASE },
      body: new URLSearchParams(body).toString(),
    });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch (e) {}
    if (j && j.code === 200) return { ok: true };
    return { ok: false, msg: '短信发送失败：HTTP ' + r.status + (j ? ' code=' + j.code : '，响应：' + txt.slice(0, 60)) };
  } catch (e) {
    return { ok: false, msg: '短信发送异常（网易接口暂不可达）：' + ((e && e.message) || e) };
  }
}

async function neteaseLogin(phone, code) {
  try {
    const body = await weapi({ phone, countrycode: '86', captcha: code, rememberLogin: 'true' });
    const r = await fetch(`${BASE}/weapi/login/cellphone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Referer: BASE + '/', Origin: BASE },
      body: new URLSearchParams(body).toString(),
    });
    const j = await r.json();
    if (j.code !== 200) return { ok: false, msg: '登录失败 code=' + j.code + (j.message ? '（' + j.message + '）' : '') };
    const ck = j.cookie || '';
    let musicU = '';
    const m = ck.match(/MUSIC_U=([^;]+)/);
    if (m) musicU = m[1];
    if (!musicU) {
      const h = r.headers.get('set-cookie') || '';
      const m2 = h.match(/MUSIC_U=([^;]+)/);
      if (m2) musicU = m2[1];
    }
    if (!musicU) return { ok: false, msg: '未取到登录凭证' };
    return { ok: true, musicU, uid: (j.profile || {}).userId };
  } catch (e) {
    return { ok: false, msg: '登录请求异常（网易接口暂不可达）：' + ((e && e.message) || e) };
  }
}

// 校验一个 MUSIC_U 是否还活着（备用通道即时反馈）
// 策略：重试 2 次；若网易接口不可达（网络/非 JSON 响应）且 cookie 形状合法，降级放行（provisional），
// 交由次日 Actions 的 login_by_cookie 复验，失效号会被 /api/report_dead 自动清理。
async function validateCookie(musicU) {
  const ck = 'MUSIC_U=' + musicU;
  let lastDiag = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      // 普通接口（非 weapi）：带 cookie 直接查账号，2026-10-10 实测返回 JSON
      const r = await fetch(`${BASE}/api/nuser/account/get`, {
        method: 'GET',
        headers: { 'User-Agent': UA, Referer: BASE + '/', 'Cookie': ck },
      });
      const txt = await r.text();
      let j = null;
      try { j = JSON.parse(txt); } catch (e) {}
      if (j && j.code === 200 && (j.profile || {}).userId) return { ok: true, uid: j.profile.userId };
      if (j) return { ok: false, msg: 'MUSIC_U 无效或已失效（code=' + j.code + '，请重新从浏览器复制）' };
      lastDiag = 'HTTP ' + r.status + '，响应非 JSON：' + txt.slice(0, 60);
    } catch (e) {
      lastDiag = '网络异常：' + ((e && e.message) || e);
    }
    if (attempt < 2) await new Promise(res => setTimeout(res, 800));
  }
  if (/^[0-9a-fA-F]{80,}$/.test(musicU)) {
    const hex = [...blake2b(utf8(musicU), 6)].map(b => b.toString(16).padStart(2, '0')).join('');
    return { ok: true, uid: Number('0x' + hex.slice(0, 12)) % 1e12, provisional: true, diag: lastDiag };
  }
  return { ok: false, msg: '校验失败：' + lastDiag + '；且 cookie 形状不对，请重新从浏览器复制 MUSIC_U' };
}

async function resolveSong(link) {
  // 容错：成员经常把 APP 分享的整段文字（带歌名/emoji/@）直接粘进来，先提取出里面的第一个 URL
  const picked = link.match(/https?:\/\/[^\s"'《》<>，,）)】]+/);
  let url = (picked ? picked[0] : link).trim();
  // 只收单曲：歌单/专辑/电台/节目/排行榜链接一律拒绝（防一个链接带出整张歌单）
  const COLLECT = /\/(playlist|album|radio|program|toplist)\b/i;
  if (COLLECT.test(url)) {
    return { ok: false, msg: '不支持歌单/专辑等合集链接（一个歌单曲目太多）。请在网易云 APP 里打开【其中一首歌】→ 点分享 → 复制链接，只登记单曲' };
  }
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA } });
    url = r.url;
  } catch (e) {}
  if (COLLECT.test(url)) {
    return { ok: false, msg: '不支持歌单/专辑等合集链接（一个歌单曲目太多）。请在网易云 APP 里打开【其中一首歌】→ 点分享 → 复制链接，只登记单曲' };
  }
  const m = url.match(/[?&]id=(\d+)/);
  if (!m) return { ok: false, msg: '链接里没找到歌曲 id：识别到 ' + url.slice(0, 80) + '。请在网易云 APP 里点「分享→复制链接」，把 http 开头的完整链接粘过来' };
  // 双保险：调网易歌曲详情接口确认这个 id 确实是一首歌（防歌单/电台 id 伪装混入）
  try {
    const r = await fetch(`${BASE}/api/song/detail?id=${m[1]}&ids=%5B${m[1]}%5D`, { headers: { 'User-Agent': UA, Referer: BASE + '/' } });
    const j = await r.json();
    if (!j || !Array.isArray(j.songs) || !j.songs.length) {
      return { ok: false, msg: '这个链接不是单曲（可能是歌单/电台/专辑 id）。请分享【单曲】：APP 里播放那首歌 → 分享 → 复制链接' };
    }
  } catch (e) {
    // 详情接口偶发异常时放行（歌单类 URL 已在上面被路径检查拦截）
  }
  return { ok: true, song: Number(m[1]) };
}

// ---- GitHub Secrets（sealed box） ----
// GH_TOKEN / GROUP_PASS 存于 KV（加密、不落仓库、不暴露给前端），运行时从 POOL 读取。
// 这样无需 Cloudflare Secret 权限即可配置，且 GitHub PAT 也不会进公开仓库文件。
let _cfg, _cfgAt = 0;
// KV 值防御性清洗：防止当初写入口令/token 时把 JSON 引号/空白一起存进去
const cleanKV = s => (s || '').trim().replace(/^"+|"+$/g, '');
async function cfg() {
  // 带 5 分钟 TTL 的缓存（2026-10-13 修复：此前永久缓存，KV 里轮换 GH_TOKEN/群口令后
  // 要等 isolate 重启才生效）
  if (!_cfg || Date.now() - _cfgAt > 300000) {
    _cfg = {
      ghToken: cleanKV(await POOL.get('GH_TOKEN')),
      groupPass: cleanKV(await POOL.get('GROUP_PASS')),
      groupPass2: cleanKV(await POOL.get('GROUP_PASS2')),
      adminPass: cleanKV(await POOL.get('ADMIN_PASS')),
      // 分群上限：一群默认 200 / 二群默认 500；旧键 POOL_LIMIT 保留但不再参与闸门
      poolLimit: parseInt(cleanKV(await POOL.get('POOL_LIMIT')), 10) || 200,
      poolLimitG1: parseInt(cleanKV(await POOL.get('POOL_LIMIT_G1')), 10) || 200,
      poolLimitG2: parseInt(cleanKV(await POOL.get('POOL_LIMIT_G2')), 10) || 500,
      owner: GH_OWNER,
      repo: GH_REPO,
    };
    _cfgAt = Date.now();
  }
  return _cfg;
}
const GH = async () => { const c = await cfg(); return { token: c.ghToken, owner: c.owner, repo: c.repo }; };
// ---- 群口令校验（定制版：无口令，一律放行）----
// 定制版页面不带群口令（用户明确要求），服务端不再校验 pass；
// 归属固定走二群闸口（见下方 isG2 = true），上限 POOL_LIMIT_G2（当前 500）。
function groupPassCheck(c, body) {
  return { ok: true };
}
// ---- 分群计数辅助：历史条目没有 grp 字段的一律算一群 ----
const grpOf = e => (Number(e && e.grp) === 2 ? 2 : 1);
const groupLimitOf = (c, isG2) => (isG2 ? c.poolLimitG2 : c.poolLimitG1);
async function ghPublicKey() {
  const g = await GH();
  const r = await fetch(`https://api.github.com/repos/${g.owner}/${g.repo}/actions/secrets/public-key`, { headers: { Authorization: `token ${g.token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'cron-relay-worker' } });
  return r.json();
}
// ---- blake2b (RFC 7693, BigInt 实现) ----
// GitHub Secrets API 要求 libsodium sealed box 格式：ephPub(32) || box(msg, nonce=blake2b24(ephPub||recipPub))
// 原实现缺临时公钥且 nonce 为零，是错的，任何密钥都写不进去。
const BLAKE2B_IV = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
];
const BLAKE2B_SIGMA = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3,
  11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4,
  7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8,
  9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13,
  2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9,
  12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11,
  13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10,
  6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5,
  10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0,
];

function blake2b(input, outlen) {
  const MASK = (1n << 64n) - 1n;
  const rotr = (x, n) => ((x >> BigInt(n)) | (x << BigInt(64 - n))) & MASK;
  const G = (v, a, b, c, d, x, y) => {
    v[a] = (v[a] + v[b] + x) & MASK;
    v[d] = rotr(v[d] ^ v[a], 32);
    v[c] = (v[c] + v[d]) & MASK;
    v[b] = rotr(v[b] ^ v[c], 24);
    v[a] = (v[a] + v[b] + y) & MASK;
    v[d] = rotr(v[d] ^ v[a], 16);
    v[c] = (v[c] + v[d]) & MASK;
    v[b] = rotr(v[b] ^ v[c], 63);
  };
  let h = BLAKE2B_IV.slice();
  h[0] ^= BigInt(outlen) | 0x01010000n;   // 无 key 的参数块
  const total = input.length;
  const nb = Math.max(1, Math.ceil(total / 128));
  const dv = new DataView(new ArrayBuffer(8));
  for (let i = 0; i < nb; i++) {
    const blk = new Uint8Array(128);
    blk.set(input.subarray(i * 128, (i + 1) * 128));
    const isLast = i === nb - 1;
    const t = BigInt(isLast ? total : (i + 1) * 128);
    // 消息字 m[0..15]，小端 64 位
    const m = [];
    for (let j = 0; j < 16; j++) {
      let w = 0n;
      for (let k = 7; k >= 0; k--) w = (w << 8n) | BigInt(blk[j * 8 + k]);
      m.push(w);
    }
    const v = new Array(16);
    for (let j = 0; j < 8; j++) v[j] = h[j];
    for (let j = 0; j < 8; j++) v[8 + j] = BLAKE2B_IV[j];
    v[12] ^= t;
    if (isLast) v[14] = ~v[14] & MASK;
    for (let r = 0; r < 12; r++) {
      const s = (r % 10) * 16;
      G(v, 0, 4, 8, 12, m[BLAKE2B_SIGMA[s]], m[BLAKE2B_SIGMA[s + 1]]);
      G(v, 1, 5, 9, 13, m[BLAKE2B_SIGMA[s + 2]], m[BLAKE2B_SIGMA[s + 3]]);
      G(v, 2, 6, 10, 14, m[BLAKE2B_SIGMA[s + 4]], m[BLAKE2B_SIGMA[s + 5]]);
      G(v, 3, 7, 11, 15, m[BLAKE2B_SIGMA[s + 6]], m[BLAKE2B_SIGMA[s + 7]]);
      G(v, 0, 5, 10, 15, m[BLAKE2B_SIGMA[s + 8]], m[BLAKE2B_SIGMA[s + 9]]);
      G(v, 1, 6, 11, 12, m[BLAKE2B_SIGMA[s + 10]], m[BLAKE2B_SIGMA[s + 11]]);
      G(v, 2, 7, 8, 13, m[BLAKE2B_SIGMA[s + 12]], m[BLAKE2B_SIGMA[s + 13]]);
      G(v, 3, 4, 9, 14, m[BLAKE2B_SIGMA[s + 14]], m[BLAKE2B_SIGMA[s + 15]]);
    }
    for (let j = 0; j < 8; j++) h[j] = (h[j] ^ v[j] ^ v[j + 8]) & MASK;
  }
  // 输出小端 64 位字，截断到 outlen
  const out = new Uint8Array(outlen);
  let o = 0;
  for (let j = 0; j < 8 && o < outlen; j++) {
    dv.setBigUint64(0, h[j], true);
    const tmp = new Uint8Array(dv.buffer);
    for (let k = 0; k < 8 && o < outlen; k++) out[o++] = tmp[k];
  }
  return out;
}

// ---- libsodium sealed box ----
function sealBox(msgU8, theirPub) {
  const eph = nacl.box.keyPair();
  const seed = new Uint8Array(64);
  seed.set(eph.publicKey, 0);
  seed.set(theirPub, 32);
  const nonce = blake2b(seed, 24);
  const boxed = nacl.box(msgU8, nonce, theirPub, eph.secretKey);
  const out = new Uint8Array(32 + boxed.length);
  out.set(eph.publicKey, 0);
  out.set(boxed, 32);
  return out;
}

async function ghPutSecret(name, value) {
  const g = await GH();
  const pk = await ghPublicKey();
  if (!pk || !pk.key || !pk.key_id) throw new Error('获取 GitHub Secrets 公钥失败（GH_TOKEN 无效/过期或仓库不对）：' + JSON.stringify(pk).slice(0, 120));
  const theirPub = b64dec(pk.key);
  const sealed = sealBox(utf8(value), theirPub);
  const r = await fetch(`https://api.github.com/repos/${g.owner}/${g.repo}/actions/secrets/${name}`, {
    method: 'PUT',
    headers: { Authorization: `token ${g.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'cron-relay-worker' },
    body: JSON.stringify({ encrypted_value: b64enc(sealed), key_id: pk.key_id }),
  });
  return r.status;
}

// ---- 分片写回 NB_POOL_1..5 ----
// added 统一按北京时间记（2026-10-13 修复：此前用 UTC，北京 0-8 点登记的号会被提前一天入池，
// 与 run.py 的北京时间口径不一致）
function beijingDate() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
// ---- 有效期（exp）：'YYYY-MM-DD' 到期即移除；无 exp / 'forever' = 永久 ----
function isExpiredEntry(e) {
  return !!(e && e.exp && e.exp !== 'forever' && String(e.exp) < beijingDate());
}
function expDaysLeft(e) {
  if (!e || !e.exp || e.exp === 'forever') return Infinity;
  return Math.round((new Date(e.exp + 'T00:00:00Z') - new Date(beijingDate() + 'T00:00:00Z')) / 86400000);
}
function isSoonExpired(e) {
  const d = expDaysLeft(e);
  return d !== Infinity && d <= 3;
}
function beijingDatePlus(n) {
  return new Date(Date.now() + 8 * 3600 * 1000 + n * 86400 * 1000).toISOString().slice(0, 10);
}
function parseExpInput(x) {
  if (x == null || String(x).trim() === '') return { ok: true };
  const s = String(x).trim();
  if (s === 'forever' || s === '永久') return { ok: true, exp: 'forever' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: true, exp: s };
  if (/^\d{1,4}$/.test(s)) return { ok: true, exp: beijingDatePlus(parseInt(s, 10)) };
  return { ok: false };
}
// 到期账号清理：删独立键 + 记墓碑 + 刷 master + 回推 GitHub Secrets（只在有过期时才写）
async function pruneExpired() {
  const master = await mergePool();
  const dead = master.filter(isExpiredEntry);
  if (!dead.length) return { master: master, count: 0 };
  await Promise.all(dead.map(e => POOL.delete(entryKeyOf(e))));
  try {
    const log = new Set(await getDeadLog());
    for (const e of dead) log.add(entryKeyOf(e));
    await POOL.put('dead_log', JSON.stringify([...log].slice(-500)));
  } catch (e) {}
  const kept = master.filter(e => !isExpiredEntry(e));
  try { await POOL.put('master', JSON.stringify(kept)); } catch (e) {}
  await pushPool(kept);
  return { master: kept, count: dead.length };
}
async function pushPool(entries) {
  const chunks = [];
  let cur = [];
  let size = 0;
  for (const e of entries) {
    const s = JSON.stringify(e).length + 1;
    if (size + s > 45000 && cur.length) { chunks.push(cur); cur = []; size = 0; }
    cur.push(e); size += s;
  }
  if (cur.length) chunks.push(cur);
  // Secrets 只有 NB_POOL_1..5 五个槽，超出的分片此前被静默丢弃（2026-10-13 加告警）
  if (chunks.length > 5) {
    const dropped = chunks.slice(5).reduce((n, c) => n + c.length, 0);
    console.error(`号池 ${entries.length} 条超出 5 片 Secrets 容量，超出的 ${dropped} 条未写入，请扩容或清理！`);
  }
  for (let i = 0; i < 5; i++) {
    const name = `NB_POOL_${i + 1}`;
    if (i < chunks.length) await ghPutSecret(name, b64enc(utf8(JSON.stringify(chunks[i]))));
    else await ghPutSecret(name, b64enc(utf8('[]')));
  }
}

// ---- 号池并发安全 ----
// 真实来源 = 每条账号一个独立 KV 键（entry: 前缀）。单键写入/删除互不干扰，从根上消除
// "整表读-改-写"竞态（此前多人同时登记会整表互相覆盖，表现为号池条目凭空减少）。
// master 键降级为合并视图缓存：即使被并发写坏，下次 mergePool 会从独立键自动重建。
function entryKeyOf(e) {
  return e && e.uid != null && String(e.uid) !== ''
    ? 'entry:u' + String(e.uid)
    : 'entry:n' + encodeURIComponent(String((e && e.name) || 'unknown'));
}

// 删除墓碑：report_dead/管理删除过的账号键记录在 dead_log，防止
// ① master 边缘缓存旧快照（≤60s）把已删条目"复活"回填；
// ② 刚被清理的成员在缓存窗口内重新登记被误判"已登记"。重新登记成功后自动移除墓碑。
async function getDeadLog() {
  try { return JSON.parse(await POOL.get('dead_log') || '[]') || []; } catch (e) { return []; }
}

async function mergePool() {
  let base = [];
  try { base = JSON.parse(await POOL.get('master') || '[]') || []; } catch (e) {}
  const deadLog = new Set(await getDeadLog());
  const byKey = new Map();
  for (const e of base) {
    if (deadLog.has(entryKeyOf(e))) continue;   // 墓碑内的缓存残留不参与（已删账号不复活）
    byKey.set(entryKeyOf(e), e);                // 顺带去重历史重复条目
  }
  // 遍历 entry: 独立键（真实来源），master 缓存里缺的补上
  const keyNames = [];
  let cursor;
  do {
    const page = await POOL.list({ prefix: 'entry:', limit: 1000, cursor });
    for (const k of page.keys) keyNames.push(k.name);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  const vals = await Promise.all(keyNames.map(n => POOL.get(n)));
  let changed = false;
  for (let i = 0; i < keyNames.length; i++) {
    if (!vals[i]) { changed = true; continue; }        // 键已删但 list 索引未收敛，跳过
    let v; try { v = JSON.parse(vals[i]); } catch (e) { continue; }
    if (!byKey.has(keyNames[i])) { byKey.set(keyNames[i], v); changed = true; }
  }
  const merged = [...byKey.values()];
  // 回填：master 有但独立键缺失的老数据（首次升级时一次性迁移，之后不再触发）
  const listed = new Set(keyNames);
  await Promise.all(merged
    .filter(e => !listed.has(entryKeyOf(e)))
    .map(e => POOL.put(entryKeyOf(e), JSON.stringify(e))));
  if (changed || merged.length !== base.length) {
    try { await POOL.put('master', JSON.stringify(merged)); } catch (e) {}
  }
  return merged;
}

async function addEntry(entry) {
  // 有效期默认永久（定制版），管理端可随时修改（exp=YYYY-MM-DD，forever=永久）
  if (!entry.exp) entry.exp = 'forever';
  // 查重：先查该账号自己的独立键（单键读，无竞态），再查合并后的主表
  const ekey = entryKeyOf(entry);
  if (await POOL.get(ekey)) {
    return { ok: false, msg: '该账号已登记过（每个账号限登记一首歌），无需重复登记。' };
  }
  const uidKey = entry.uid != null ? String(entry.uid) : null;
  const deadLog = new Set(await getDeadLog());
  const master = await mergePool();
  for (const e of master) {
    if (deadLog.has(entryKeyOf(e))) continue;   // 墓碑内的是缓存残留（刚被清理），不算已登记
    if (uidKey && e.uid != null && String(e.uid) === uidKey) {
      return { ok: false, msg: '该账号已登记过（每个账号限登记一首歌），无需重复登记。' };
    }
    if (entry.name && e.name === entry.name) {
      return { ok: false, msg: '该手机号/账号已登记过（每个账号限登记一首歌），无需重复登记。' };
    }
  }
  // 权威写入：只写自己的独立键，永远不会覆盖别人的登记
  await POOL.put(ekey, JSON.stringify(entry));
  // 重新登记成功 → 清掉墓碑（dead_log 里移除本账号的 uid 键与 name 键两种形态）
  if (deadLog.size) {
    const cleared = [...deadLog].filter(k => k !== ekey
      && !(uidKey && k === 'entry:u' + uidKey)
      && !(entry.name && k === 'entry:n' + encodeURIComponent(String(entry.name))));
    if (cleared.length !== deadLog.size) {
      try { await POOL.put('dead_log', JSON.stringify(cleared)); } catch (e) {}
    }
  }
  // master 缓存尽力刷新（此写有竞态也无害：下次 mergePool 自愈）
  const updated = master.concat([entry]);
  try { await POOL.put('master', JSON.stringify(updated)); } catch (e) {}
  await pushPool(updated);
  return { ok: true };
}

async function handle(request) {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(INDEX_HTML_DZ, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    // ---- 二群登记页：独立口令（KV: GROUP_PASS2），与一群共用同一个号池 ----
    if (url.pathname === '/g2') {
      return new Response(INDEX_HTML_G2, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    // ---- 群主管理后台（只读）：ADMIN_PASS 独立口令，NOT 群口令 ----
    if (url.pathname === '/admin' && request.method === 'GET') {
      return new Response(ADMIN_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    // 本地后台网页（号池管理网页.html）跨域调用本接口：放开 CORS 并处理预检
    if (url.pathname === '/api/pool' && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      } });
    }
    if (url.pathname === '/api/pool' && request.method === 'POST') {
      const CORS = { 'Access-Control-Allow-Origin': '*' };
      let body;
      try { body = await request.json(); } catch (e) { return json({ message: '参数错误' }, 400, CORS); }
      const c = await cfg();
      if (!c.adminPass) return json({ message: '尚未设置管理密码：请在 Cloudflare KV 中添加 ADMIN_PASS 键（任意长随机字符串）' }, 503, CORS);
      if (!body.pass || body.pass !== c.adminPass) return json({ message: '管理密码错误' }, 403, CORS);
      const pr = await pruneExpired();
      const master = pr.master;
      // 只回展示字段，绝不下发 ck（cookie）等敏感数据
      const entries = master.map(e => ({
        name: e.name || '', uid: e.uid != null ? String(e.uid) : '',
        song: e.song != null ? String(e.song) : '', added: e.added || '',
        email: e.email || '', phone: e.phone || '', noListen: !!e.noListen, exp: e.exp || '',
      }));
      const stats = {
        total: entries.length,
        withMail: entries.filter(e => e.email).length,
        noMail: entries.filter(e => !e.email).length,
        noListen: entries.filter(e => e.noListen).length,
        public: entries.filter(e => !e.song).length,
        expiring: entries.filter(isSoonExpired).length,
        manual: entries.filter(e => String(e.name).indexOf('manual:') === 0).length,
        limit: c.poolLimitG2,
        remain: Math.max(0, c.poolLimitG2 - entries.length),
      };
      return json({ ok: true, stats: stats, entries: entries }, 200, CORS);
    }
    // ---- 管理端账号维护（本地管理页专用）：删除 / 修改（CK、邮箱、歌曲、有效期、暂停互听）----
    if (url.pathname === '/api/admin/entry' && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      } });
    }
    if (url.pathname === '/api/admin/entry' && request.method === 'POST') {
      const CORS = { 'Access-Control-Allow-Origin': '*' };
      let body;
      try { body = await request.json(); } catch (e) { return json({ message: '参数错误' }, 400, CORS); }
      const c = await cfg();
      if (!c.adminPass) return json({ message: '尚未设置管理密码' }, 503, CORS);
      if (!body.pass || body.pass !== c.adminPass) return json({ message: '管理密码错误' }, 403, CORS);
      const master = await mergePool();
      const target = master.find(e =>
        (body.uid != null && String(body.uid) !== '' && e.uid != null && String(e.uid) === String(body.uid)) ||
        (body.name && String(e.name) === String(body.name)));
      if (!target) return json({ message: '没找到该账号（可能已被删除）' }, 404, CORS);
      if (body.action === 'delete') {
        await POOL.delete(entryKeyOf(target));
        try {
          const log = new Set(await getDeadLog());
          log.add(entryKeyOf(target));
          await POOL.put('dead_log', JSON.stringify([...log].slice(-500)));
        } catch (e) {}
        const kept = master.filter(e => e !== target);
        try { await POOL.put('master', JSON.stringify(kept)); } catch (e) {}
        await pushPool(kept);
        return json({ ok: true, message: '已删除账号 ' + (target.name || target.uid) }, 200, CORS);
      }
      if (body.action === 'update') {
        const changes = [];
        if (body.ck != null && String(body.ck).trim() !== '') {
          let mu = String(body.ck).trim();
          const mm = mu.match(/MUSIC_U=([^;\s"']+)/);
          if (mm) mu = mm[1];
          if (!/^[A-Za-z0-9%_-]{20,}$/.test(mu)) return json({ message: 'MUSIC_U 格式不对（应为 32 位左右的长字符串）' }, 400, CORS);
          const v = await validateCookie(mu);
          if (!v.ok) return json({ message: '新 CK 校验未通过：' + v.msg }, 400, CORS);
          target.ck = 'MUSIC_U=' + mu;
          changes.push('CK');
        }
        if (body.link != null && String(body.link).trim() !== '') {
          const song = await resolveSong(String(body.link));
          if (!song.ok) return json({ message: song.msg }, 400, CORS);
          target.song = song.song;
          changes.push('歌曲');
        }
        if (body.email != null && String(body.email).trim() !== '') {
          const em = String(body.email).trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return json({ message: '邮箱格式不对' }, 400, CORS);
          target.email = em;
          changes.push('邮箱');
        }
        if (body.exp != null && String(body.exp).trim() !== '') {
          const x = String(body.exp).trim();
          if (x === 'forever' || x === '永久') { delete target.exp; changes.push('有效期=永久'); }
          else if (/^\d{4}-\d{2}-\d{2}$/.test(x)) { target.exp = x; changes.push('有效期=' + x); }
          else if (/^\d{1,3}$/.test(x)) { const d = beijingDatePlus(parseInt(x, 10)); target.exp = d; changes.push('有效期=' + x + '天(' + d + '止)'); }
          else return json({ message: '有效期格式不对：填天数(如30)、日期(2026-12-31)或"永久"' }, 400, CORS);
        }
        if (body.noListen !== undefined && body.noListen !== null) {
          target.noListen = !!body.noListen;
          changes.push(body.noListen ? '暂停互听(只收不听)' : '恢复互听');
        }
        if (!changes.length) return json({ message: '没有要修改的内容（各栏留空=不改）' }, 400, CORS);
        await POOL.put(entryKeyOf(target), JSON.stringify(target));
        try { await POOL.put('master', JSON.stringify(master)); } catch (e) {}
        await pushPool(master);
        return json({ ok: true, message: '已修改 ' + (target.name || target.uid) + '：' + changes.join('、') }, 200, CORS);
      }
      return json({ message: '未知操作' }, 400, CORS);
    }
    if (url.pathname === '/api/sendcode' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch (e) { return json({ message: '参数错误' }, 400); }
      // 2026-10-13 修复：此前唯一没挂群口令的写接口，可被匿名调用给任意手机号发验证码短信
      const c0 = await cfg();
      const gp0 = groupPassCheck(c0, body);
      if (!gp0.ok) return json({ message: gp0.msg }, gp0.status);
      const send = await neteaseSendCode(body.phone);
      if (!send.ok) return json({ message: send.msg }, 400);
      return json({ message: 'ok' });
    }
    if (url.pathname === '/api/join' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch (e) { return json({ message: '参数错误' }, 400); }
      const c = await cfg();
      const gp1 = groupPassCheck(c, body);
      if (!gp1.ok) return json({ message: gp1.msg }, gp1.status);
      // 号池满员闸口（分群计数：一群上限 POOL_LIMIT_G1 默认 200 / 二群上限 POOL_LIMIT_G2 默认 500），
      // 满员后暂停该群新登记；历史条目没有 grp 字段的一律算一群
      const isG2 = true; // 定制版 worker：固定按二群闸口（POOL_LIMIT_G2）计数
      const myLimit = groupLimitOf(c, isG2);
      const _m1 = await mergePool();
      const grpUsed = _m1.filter(e => grpOf(e) === (isG2 ? 2 : 1)).length;
      if (grpUsed >= myLimit) return json({ message: '本群名额已满（上限 ' + myLimit + ' 人），暂停登记。已有账号的互听和签到不受影响，请稍后再试或联系群主。' }, 429);
      const email = (body.email || '').trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ message: '请填写常用邮箱' }, 400);
      const login = await neteaseLogin(body.phone, body.code);
      if (!login.ok) return json({ message: login.msg }, 400);
      const song = await resolveSong(body.link);
      if (!song.ok) return json({ message: song.msg }, 400);
      const expQ = parseExpInput(body.exp);
      if (!expQ.ok) return json({ message: '有效期格式不对：填天数(如730)、日期(2028-10-18)或"永久"（不填=永久）' }, 400);
      const r = await addEntry({ ck: 'MUSIC_U=' + login.musicU, song: song.song, added: beijingDate(), name: body.phone, uid: login.uid, email: email, grp: isG2 ? 2 : 1, exp: expQ.exp });
      if (!r.ok) return json({ message: r.msg }, 400);
      return json({ message: '登记成功，次日生效。' });
    }
    if (url.pathname === '/api/join_manual' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch (e) { return json({ message: '参数错误' }, 400); }
      const c = await cfg();
      const gp2 = groupPassCheck(c, body);
      if (!gp2.ok) return json({ message: gp2.msg }, gp2.status);
      // 号池满员闸口（分群计数，与方式一同一把闸，防止走备用通道绕过）
      const isG2 = true; // 定制版 worker：固定按二群闸口（POOL_LIMIT_G2）计数
      const myLimit = groupLimitOf(c, isG2);
      const _m2 = await mergePool();
      const grpUsed = _m2.filter(e => grpOf(e) === (isG2 ? 2 : 1)).length;
      if (grpUsed >= myLimit) return json({ message: '本群名额已满（上限 ' + myLimit + ' 人），暂停登记。已有账号的互听和签到不受影响，请稍后再试或联系群主。' }, 429);
      const mu = (body.musicU || '').trim();
      if (!mu) return json({ message: '请填写 MUSIC_U' }, 400);
      const email = (body.email || '').trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ message: '请填写常用邮箱' }, 400);
      const v = await validateCookie(mu);
      if (!v.ok) return json({ message: v.msg }, 400);
      const song = await resolveSong(body.link);
      if (!song.ok) return json({ message: song.msg }, 400);
      const expQ = parseExpInput(body.exp);
      if (!expQ.ok) return json({ message: '有效期格式不对：填天数(如730)、日期(2028-10-18)或"永久"（不填=永久）' }, 400);
      const phoneRaw = (body.phone || '').replace(/[^0-9]/g, '');
      const phone = /^1\d{10}$/.test(phoneRaw) ? phoneRaw : '';
      const r = await addEntry({ ck: 'MUSIC_U=' + mu, song: song.song, added: beijingDate(), name: phone || ('manual:' + v.uid), uid: v.uid, email: email, phone: phone, grp: isG2 ? 2 : 1, exp: expQ.exp });
      if (!r.ok) return json({ message: r.msg }, 400);
      let msg = '备用登记成功，次日生效。';
      if (v.provisional) msg += '（注：网易校验接口暂时不可达[' + (v.diag || '') + ']，已跳过在线校验；明天任务会自动复验）';
      return json({ message: msg });
    }
    // ---- 补录/修改通知邮箱（老号自助通道，只改 email 一个字段，其余原样）----
    if (url.pathname === '/api/updatemail' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch (e) { return json({ message: '参数错误' }, 400); }
      const c = await cfg();
      const gp3 = groupPassCheck(c, body);
      if (!gp3.ok) return json({ message: gp3.msg }, gp3.status);
      const email = (body.email || '').trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ message: '请填写常用邮箱' }, 400);
      const phone = (body.phone || '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/[^0-9]/g, '');
      const mu = (body.mu || '').trim();
      if (!phone && !mu) return json({ message: '请填写手机号或 MUSIC_U（至少填一个）' }, 400);
      const master = await mergePool();
      let target = null;
      if (mu) {
        const v = await validateCookie(mu);
        if (!v.ok) return json({ message: v.msg }, 400);
        target = master.find(e => e.uid != null && String(e.uid) === String(v.uid)) || null;
      } else {
        target = master.find(e => e.name === phone) || null;
      }
      if (!target) return json({ message: '没有找到你的登记记录：请检查手机号/MUSIC_U 是否填错；如果还没登记过，请用上方的登记方式。' }, 404);
      target.email = email;
      // 与 addEntry 同一套写入机制：独立键权威写 + master 缓存刷新 + 同步号池 Secrets
      await POOL.put(entryKeyOf(target), JSON.stringify(target));
      const updated = master.map(e => entryKeyOf(e) === entryKeyOf(target) ? target : e);
      try { await POOL.put('master', JSON.stringify(updated)); } catch (e) {}
      await pushPool(updated);
      return json({ message: '已保存：' + email + '。之后账号有变化，会发邮件到这个邮箱。' });
    }
    // ---- 二维码登录通道（实测网易是否放行 CF 机房 IP）----
    // GET /api/qr_key  → 网易申请 unikey
    // GET /api/qr_check?key=xxx → 轮询：800过期/801等待/802已扫/803成功（成功时从 set-cookie 提取 MUSIC_U 放进 JSON 返回）
    if (url.pathname === '/api/qr_key' && request.method === 'GET') {
      const r = await fetch(BASE + '/api/login/qrcode/unikey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, 'Referer': BASE + '/' },
        body: 'type=1',
      });
      const text = await r.text();
      return new Response(text, { status: r.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    if (url.pathname === '/api/qr_check' && request.method === 'GET') {
      const key = (url.searchParams.get('key') || '').trim();
      if (!key) return json({ message: '缺少 key' }, 400);
      const r = await fetch(BASE + '/api/login/qrcode/client/login?key=' + encodeURIComponent(key) + '&type=1', {
        headers: { 'User-Agent': UA, 'Referer': BASE + '/' },
      });
      const text = await r.text();
      let out = text;
      try {
        const j = JSON.parse(text);
        if (j.code === 803) {
          const sc = r.headers.get('set-cookie') || '';
          const m = sc.match(/MUSIC_U=([^;]+)/);
          j.musicU = m ? m[1] : '';
          out = JSON.stringify(j);
        }
      } catch (e) { /* 非 JSON（被风控页拦截）原样返回，前端据此判失败 */ }
      return new Response(out, { status: r.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    // 隐藏管理接口：用群口令保护，从 KV 主表重新把 NB_POOL_1..5 推回 GitHub Secrets（KV 丢失/Secrets 异常时一键恢复）
    if (url.pathname === '/api/resync' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch (e) { return json({ message: '参数错误' }, 400); }
      const c = await cfg();
      if (body.pass !== c.groupPass) return json({ message: '群口令错误' }, 403);
      let master = await mergePool();
      await pushPool(master);
      return json({ message: `已从 KV 重新同步 ${master.length} 条到 GitHub Secrets（NB_POOL_1..5）。` });
    }
    // 失效账号清理：Actions 跑完发现 cookie 失效的号，按 name/uid 从号池剔除并重写分片
    if (url.pathname === '/api/report_dead' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch (e) { return json({ message: '参数错误' }, 400); }
      const c = await cfg();
      if (body.pass !== c.groupPass) return json({ message: '群口令错误' }, 403);
      const deadSet = new Set((body.dead || []).map(x => String(x)));
      if (!deadSet.size) return json({ message: '没有需要清理的账号。' });
      const master = await mergePool();
      const before = master.length;
      // 删除走独立键（单键删除，无竞态），并记墓碑防缓存复活；再刷新 master 缓存
      const deadEntries = master.filter(e => deadSet.has(String(e.name)) || deadSet.has(String(e.uid)));
      const deadEkeys = deadEntries.map(e => entryKeyOf(e));
      await Promise.all(deadEntries.map(e => POOL.delete(entryKeyOf(e))));
      if (deadEkeys.length) {
        try {
          const log = new Set(await getDeadLog());
          for (const k of deadEkeys) log.add(k);
          // 只留最近 500 条，防止无限增长
          await POOL.put('dead_log', JSON.stringify([...log].slice(-500)));
        } catch (e) {}
      }
      const after = master.filter(e => !deadSet.has(String(e.name)) && !deadSet.has(String(e.uid)));
      try { await POOL.put('master', JSON.stringify(after)); } catch (e) {}
      await pushPool(after);
      return json({ message: `清理 ${before - after.length} 个失效账号，剩余 ${after.length} 个。` });
    }
    return json({ message: 'not found' }, 404);
}

function json(o, status = 200, extraHeaders) { return new Response(JSON.stringify(o), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {}) }); }

const INDEX_HTML = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>成员接入</title><style>body{font-family:-apple-system,system-ui,"PingFang SC",sans-serif;background:#f5f6f8;margin:0;padding:24px 12px;display:flex;flex-direction:column;align-items:center;gap:16px}.head{text-align:center;margin-bottom:2px}.page-title{font-size:20px;font-weight:600;color:#3b6d11;margin:0}.page-sub{font-size:13px;color:#666;margin:6px 0 0}.wrap{display:flex;flex-wrap:wrap;gap:18px;justify-content:center;width:100%;max-width:1060px}.card{background:#fff;padding:26px 22px;border-radius:14px;width:330px;min-width:0;box-sizing:border-box;box-shadow:0 2px 12px rgba(0,0,0,.08)}h1{font-size:17px;margin:0 0 4px}h1.alt{color:#b06a00}p{font-size:13px;color:#666;margin:0 0 16px;line-height:1.5}label{display:block;font-size:13px;margin:12px 0 4px;color:#333}input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px}.row{display:flex;gap:8px}.row input{flex:1}button{margin-top:14px;width:100%;padding:11px;border:0;border-radius:8px;background:#3b6d11;color:#fff;font-size:15px;cursor:pointer}button.mini{margin-top:0;width:auto;padding:10px 12px;font-size:13px;background:#5a8f1d;white-space:nowrap}button:disabled{opacity:.55;cursor:default}.msg{margin-top:14px;font-size:13px;min-height:18px;line-height:1.5}.ok{color:#3b6d11}.err{color:#a32d2d}.tip{color:#666}details{margin-top:14px;font-size:12px;color:#666;line-height:1.6}summary{cursor:pointer;color:#3b6d11}code{background:#eee;padding:1px 4px;border-radius:4px}.admin-entry{margin:10px 0 0;font-size:12px}.admin-entry a{color:#3b6d11;text-decoration:none;border-bottom:1px dashed #3b6d11;padding-bottom:1px}.abox{background:#fff;padding:22px;border-radius:14px;box-shadow:0 2px 12px rgba(0,0,0,.08);width:100%;max-width:1060px;box-sizing:border-box}.stats{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 14px}.stat{flex:1;min-width:100px;background:#f2f7ea;border-radius:10px;padding:10px 12px;text-align:center}.stat b{display:block;font-size:20px;color:#3b6d11}.stat span{font-size:12px;color:#666}.stat.warn b{color:#b06a00}.stat.warn{background:#fdf3e3}.tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}.tools input{flex:1;min-width:160px;padding:9px 10px;border:1px solid #ddd;border-radius:8px;font-size:14px}.tools button{margin-top:0;width:auto;padding:9px 14px;font-size:13px}button.gray{background:#888}.twrap{overflow-x:auto;border:1px solid #eee;border-radius:10px}table{border-collapse:collapse;width:100%;font-size:13px}th{background:#f5f6f8;text-align:left;padding:9px 10px;white-space:nowrap;color:#444;border-bottom:1px solid #eee}td{padding:8px 10px;border-bottom:1px solid #f2f2f2;white-space:nowrap}tr:hover td{background:#fafdf5}.badge{display:inline-block;font-size:11px;padding:1px 7px;border-radius:8px;margin-right:4px}.b-red{background:#fbe4e4;color:#a32d2d}.b-gray{background:#eee;color:#666}.b-yellow{background:#fdf3e3;color:#b06a00}.num{font-family:ui-monospace,Consolas,monospace;color:#555}</style></head><body><div class="head"><h1 class="page-title">成员接入</h1><p class="page-sub">上方两种方式登记新账号；已经登记过的成员，可在下方补录或修改通知邮箱（页面版本 v20261017b）</p><p class="admin-entry"><a href="/admin">群主管理后台</a></p></div><div class="wrap"><div class="card"><h1>成员接入（方式一 · 手机登录）</h1><p>① 填群口令 → ② 填邮箱 → ③ 填手机号 → ④ 点「获取验证码」收短信 → ⑤ 填验证码和歌曲链接 → ⑥ 点登记。系统自动登录并登记，<b>次日生效</b>。邮箱用于接收账号提醒：账号需要完成一次验证、或登录过期时，会发邮件到这个邮箱通知你。注意：<b>每个账号限登记一首歌</b>，重复登记会被拒绝；<b>号池上限 200 人</b>，满员后暂停登记。<b>若提示短信发送失败（网易限制机房 IP，属正常现象），请直接用下方方式二。</b></p><label>手机号</label><input id="phone" inputmode="numeric" maxlength="11" placeholder="11 位手机号"><label>短信验证码</label><div class="row"><input id="code" inputmode="numeric" maxlength="6" placeholder="网易云短信验证码"><button id="send" class="mini">获取验证码</button></div><label>分享链接</label><input id="link" placeholder="粘贴 APP 内分享的单曲链接"><label>群口令</label><input id="pass" type="text" placeholder="群内获取的群口令"><label>邮箱（必填）</label><input id="email" type="text" placeholder="账号有变化时邮件通知你"><button id="btn">登录并登记</button><div class="msg tip" id="msg">提示：只支持【单曲】链接，歌单/专辑会被拒绝。链接在网易云 APP 里「分享→复制链接」即可。</div></div><div class="card"><h1 class="alt">成员接入（方式二 · 推荐）</h1><p>最稳的登记方式：自己从浏览器复制 <code>MUSIC_U</code> 粘贴过来，同样<b>次日生效</b>。<b>每个账号限登记一首歌</b>，重复登记会被拒绝。</p><label>MUSIC_U</label><input id="mu" placeholder="粘贴浏览器里的 MUSIC_U 值"><label>分享链接</label><input id="link2" placeholder="粘贴 APP 内分享的单曲链接"><label>群口令</label><input id="pass2" type="text" placeholder="群内获取的群口令"><label>邮箱（必填）</label><input id="email2" type="text" placeholder="账号有变化时邮件通知你"><button id="btn2">备用登记</button><details><summary>怎么拿到 MUSIC_U？（点开看）</summary>用电脑浏览器打开 <code>https://music.163.com</code> 并登录 → 按 <code>F12</code> → 切到「Application / 应用」标签 → 左侧展开 <code>Cookies</code> → 选 <code>music.163.com</code> → 在右边找到名为 <code>MUSIC_U</code> 的那一行，复制它的「Value / 值」整串粘进来即可。</details><div class="msg tip" id="msg2"></div></div><div class="card"><h1 class="alt">绑定 / 更换通知邮箱</h1><p>之前登记时没填邮箱、或者想换一个邮箱，在这里改一下就行。<b>只改邮箱，其他设置原样不动</b>，之后想再换随时能来改。账号有变化时（比如需要完成一次验证、登录过期），会发邮件到这个邮箱提醒你。</p><label>手机号（方式一登记的填这个）</label><input id="pm_phone" inputmode="numeric" maxlength="11" placeholder="登记时用的 11 位手机号"><label>MUSIC_U（方式二登记的填这个，与手机号二选一即可）</label><input id="pm_mu" placeholder="方式二登记时粘贴的 MUSIC_U"><label>常用邮箱</label><input id="pm_email" type="text" placeholder="name@qq.com"><label>群口令</label><input id="pm_pass" type="text" placeholder="群内获取的群口令"><button id="btn3">保存邮箱</button><div class="msg tip" id="msg3">手机号和 MUSIC_U 填其中一个就行。</div></div></div><script>const $=id=>document.getElementById(id);function normPhone(s){return (s||'').replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-65248)).replace(/[^0-9]/g,'');}function setMsg(el,t,cls){const m=$(el);m.textContent=t;m.className='msg'+(cls?(' '+cls):'');}let timer=null;$('send').onclick=async()=>{const phone=normPhone($('phone').value),pass=$('pass').value.trim();if(!/^1[0-9]{10}$/.test(phone)){setMsg('msg','手机号格式不对：识别到 '+phone.length+' 位（'+phone+'）。若带了 +86 前缀请删掉，只填 11 位号码','err');return;}if(!pass){setMsg('msg','请先填写群口令（群内获取，填了口令才能收验证码）','err');return;}$('send').disabled=true;setMsg('msg','正在发送验证码…');try{const r=await fetch('/api/sendcode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,pass})});const d=await r.json();if(r.ok){setMsg('msg','验证码已发送，请查收短信','ok');startCd();}else{setMsg('msg',d.message||'发送失败，请重试','err');$('send').disabled=false;}}catch(e){setMsg('msg','网络错误，请重试','err');$('send').disabled=false;}};function startCd(){let cd=60;$('send').textContent=cd+'s';timer=setInterval(()=>{cd--;if(cd<=0){clearInterval(timer);timer=null;$('send').textContent='获取验证码';$('send').disabled=false;}else{$('send').textContent=cd+'s';}},1000);}$('btn').onclick=async()=>{const phone=normPhone($('phone').value),code=$('code').value.trim(),link=$('link').value.trim(),pass=$('pass').value.trim(),email=$('email').value.trim();if(!/^1[0-9]{10}$/.test(phone)){setMsg('msg','手机号格式不对','err');return;}if(!/^[0-9]{4,6}$/.test(code)){setMsg('msg','请填写验证码','err');return;}if(!link){setMsg('msg','请填写歌曲链接','err');return;}if(!email){setMsg('msg','请填写邮箱（用于接收任务验证码与异常提醒）','err');return;}setMsg('msg','处理中…');$('btn').disabled=true;try{const r=await fetch('/api/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,code,link,pass,email})});const d=await r.json();if(r.ok){setMsg('msg',d.message||'登记成功，次日开始。','ok');}else{setMsg('msg',d.message||'失败','err');}}catch(e){setMsg('msg','网络错误','err');}$('btn').disabled=false;};$('btn2').onclick=async()=>{const musicU=$('mu').value.trim(),link=$('link2').value.trim(),pass=$('pass2').value.trim(),email=$('email2').value.trim();if(!musicU){setMsg('msg2','请填写 MUSIC_U','err');return;}if(!email){setMsg('msg2','请填写邮箱（用于接收任务验证码与异常提醒）','err');return;}if(!link){setMsg('msg2','请填写歌曲链接','err');return;}setMsg('msg2','处理中…');$('btn2').disabled=true;try{const r=await fetch('/api/join_manual',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({musicU,link,pass,email})});const d=await r.json();if(r.ok){setMsg('msg2',d.message||'备用登记成功，次日开始。','ok');}else{setMsg('msg2',d.message||'失败','err');}}catch(e){setMsg('msg2','网络错误','err');}$('btn2').disabled=false;};$('btn3').onclick=async()=>{const phone=normPhone($('pm_phone').value),mu=$('pm_mu').value.trim(),email=$('pm_email').value.trim(),pass=$('pm_pass').value.trim();if(!phone&&!mu){setMsg('msg3','手机号和 MUSIC_U 至少填一个（方式二登记的填 MUSIC_U）','err');return;}if(!email){setMsg('msg3','请填写常用邮箱','err');return;}if(!pass){setMsg('msg3','请先填写群口令','err');return;}setMsg('msg3','正在保存…');$('btn3').disabled=true;try{const r=await fetch('/api/updatemail',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,mu,email,pass})});const d=await r.json();if(r.ok){setMsg('msg3',d.message||'已保存','ok');}else{setMsg('msg3',d.message||'保存失败','err');}}catch(e){setMsg('msg3','网络错误','err');}$('btn3').disabled=false;};</script><script>(function(){var re=/(登录失败|短信发送失败)/,done=false;function fire(){if(done)return;done=true;var mu=document.getElementById('mu');if(mu){var c=mu.closest('.card');if(c){c.style.outline='2px solid #b06a00';c.scrollIntoView({behavior:'smooth',block:'center'});}}var ds=document.querySelectorAll('details');for(var i=0;i<ds.length;i++){try{ds[i].open=true;}catch(e){}}var m=document.getElementById('msg2');if(m){m.textContent='⚠️ 方法一被网易风控拦截（如 8860），请改用下方方法二：先登录 music.163.com，再按说明复制 MUSIC_U 粘贴到输入框';m.className='msg err';}}try{new MutationObserver(function(){document.querySelectorAll('.msg').forEach(function(el){if(re.test(el.textContent||''))fire();});}).observe(document.body,{subtree:true,childList:true,characterData:true});}catch(e){}})();</script></body></html>`;
// 二群登记页：由 INDEX_HTML 原样派生——只替换标题/版本标识，并给 4 个登记接口的请求体
// 加上 group:2（服务端据此校验二群口令 GROUP_PASS2、按二群上限 POOL_LIMIT_G2 计数）。
// 号池完全共用：登记、查重、死号清理都走同一套 KV 逻辑；一群页面（/）不受任何影响。
const INDEX_HTML_G2 = INDEX_HTML
  .replace('<title>成员接入</title>', '<title>成员接入（二群）</title>')
  .replace('<h1 class="page-title">成员接入</h1>', '<h1 class="page-title">成员接入（二群）</h1>')
  .replace('（页面版本 v20261017b）', '（页面版本 v20261018a · 二群）')
  .replace('JSON.stringify({phone,pass})', 'JSON.stringify({phone,pass,group:2})')
  .replace('JSON.stringify({phone,code,link,pass,email})', 'JSON.stringify({phone,code,link,pass,email,group:2})')
  .replace('JSON.stringify({musicU,link,pass,email})', 'JSON.stringify({musicU,link,pass,email,group:2})')
  .replace('JSON.stringify({phone,mu,email,pass})', 'JSON.stringify({phone,mu,email,pass,group:2})');

// 定制版登记页：由 INDEX_HTML（一群原版页）派生——
// 1) 标题/版本标识显示"定制版"，页面不出现任何"二群"字样；
// 2) 去掉群口令输入框与前端口令校验（服务端 groupPassCheck 也已放行）；
// 3) 上限文案写 500（实际闸口为服务端 POOL_LIMIT_G2）；
// 4) 4 个接口请求体带 group:2 且不带 pass。
const INDEX_HTML_DZ = INDEX_HTML
  .replace('<title>成员接入</title>', '<title>成员接入（定制版）</title>')
  .replace('<h1 class="page-title">成员接入</h1>', '<h1 class="page-title">成员接入（定制版）</h1>')
  .replace('（页面版本 v20261017b）', '（页面版本 v20261018a · 定制版）')
  .replace('① 填群口令 → ② 填邮箱 → ③ 填手机号 → ④ 点「获取验证码」收短信 → ⑤ 填验证码和歌曲链接 → ⑥ 点登记', '① 填邮箱 → ② 填手机号 → ③ 点「获取验证码」收短信 → ④ 填验证码和歌曲链接 → ⑤ 点登记')
  .replace('号池上限 200 人', '号池上限 500 人')
  .replace('<label>群口令</label><input id="pass" type="text" placeholder="群内获取的群口令">', '')
  .replace('<label>群口令</label><input id="pass2" type="text" placeholder="群内获取的群口令">', '')
  .replace('<label>群口令</label><input id="pm_pass" type="text" placeholder="群内获取的群口令">', '')
  .replace('const phone=normPhone($(\'phone\').value),pass=$(\'pass\').value.trim();', 'const phone=normPhone($(\'phone\').value);')
  .replace('if(!pass){setMsg(\'msg\',\'请先填写群口令（群内获取，填了口令才能收验证码）\',\'err\');return;}', '')
  .replace('link=$(\'link\').value.trim(),pass=$(\'pass\').value.trim(),email=$(\'email\').value.trim();', 'link=$(\'link\').value.trim(),email=$(\'email\').value.trim();')
  .replace('link=$(\'link2\').value.trim(),pass=$(\'pass2\').value.trim(),email=$(\'email2\').value.trim();', 'link=$(\'link2\').value.trim(),email=$(\'email2\').value.trim();')
  .replace('const phone=normPhone($(\'pm_phone\').value),mu=$(\'pm_mu\').value.trim(),email=$(\'pm_email\').value.trim(),pass=$(\'pm_pass\').value.trim();', 'const phone=normPhone($(\'pm_phone\').value),mu=$(\'pm_mu\').value.trim(),email=$(\'pm_email\').value.trim();')
  .replace('if(!pass){setMsg(\'msg3\',\'请先填写群口令\',\'err\');return;}', '')
  .replace('JSON.stringify({phone,pass})', 'JSON.stringify({phone,group:2})')
  .replace('JSON.stringify({phone,code,link,pass,email})', 'JSON.stringify({phone,code,link,email,group:2})')
  .replace('JSON.stringify({musicU,link,pass,email})', 'JSON.stringify({musicU,link,email,group:2})')
  .replace('JSON.stringify({phone,mu,email,pass})', 'JSON.stringify({phone,mu,email,group:2})');

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>号池管理后台</title>
<style>
body{font-family:-apple-system,system-ui,"PingFang SC",sans-serif;background:#f5f6f8;margin:0;padding:24px 12px;display:flex;flex-direction:column;align-items:center;gap:16px}
.head{text-align:center}.page-title{font-size:20px;font-weight:600;color:#3b6d11;margin:0}
.page-sub{font-size:13px;color:#666;margin:6px 0 0}
.abox{background:#fff;padding:22px;border-radius:14px;box-shadow:0 2px 12px rgba(0,0,0,.08);width:100%;max-width:1060px;box-sizing:border-box}
h2{font-size:16px;margin:0 0 4px}
.tip{font-size:12px;color:#999;margin:0 0 14px}
input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px}
button{margin-top:12px;width:100%;padding:11px;border:0;border-radius:8px;background:#3b6d11;color:#fff;font-size:15px;cursor:pointer}
button.gray{background:#999}
button.mini{margin-top:0;width:auto;padding:9px 14px;font-size:13px}
button:disabled{opacity:.55;cursor:default}
.msg{margin-top:12px;font-size:13px;min-height:18px}
.ok{color:#3b6d11}.err{color:#a32d2d}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 14px}
.stat{flex:1;min-width:104px;background:#f2f7ea;border-radius:10px;padding:10px 12px;text-align:center}
.stat b{display:block;font-size:20px;color:#3b6d11}
.stat span{font-size:12px;color:#666}
.stat.warn{background:#fdf3e3}.stat.warn b{color:#b06a00}
.tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
.tools input{flex:1;min-width:160px}
.twrap{overflow-x:auto;border:1px solid #eee;border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:13px}
th{background:#f5f6f8;text-align:left;padding:9px 10px;white-space:nowrap;color:#444;border-bottom:1px solid #eee}
td{padding:8px 10px;border-bottom:1px solid #f2f2f2;white-space:nowrap}
tr:hover td{background:#fafdf5}
.badge{display:inline-block;font-size:11px;padding:1px 7px;border-radius:8px;margin-right:4px}
.b-red{background:#fbe4e4;color:#a32d2d}.b-gray{background:#eee;color:#666}.b-yellow{background:#fdf3e3;color:#b06a00}
.num{font-family:ui-monospace,Consolas,monospace;color:#555}
a.song{color:#3b6d11;text-decoration:none;border-bottom:1px dotted #3b6d11}
</style>
</head>
<body>
<div class="head"><h1 class="page-title">互听群号池管理后台</h1><p class="page-sub">仅群主可访问，页面不显示登录凭证</p></div>

<div class="abox" id="loginBox">
  <h2>管理密码</h2>
  <p class="tip">与群口令相互独立。输入后浏览器会本地记住，过期可点"退出登录"清除。</p>
  <input id="pw" type="password" placeholder="管理密码（ADMIN_PASS）">
  <button id="btn">进入后台</button>
  <div class="msg" id="lm"></div>
</div>

<div class="abox" id="mainBox" hidden>
  <div class="stats" id="stats"></div>
  <div class="tools">
    <input id="q" placeholder="搜索：账号 / 邮箱 / UID / 歌曲ID">
    <button class="mini" id="btnCsv">导出 CSV</button>
    <button class="mini" id="btnCopy">复制未绑邮箱名单</button>
    <button class="mini" id="btnRefresh">刷新</button>
    <button class="mini gray" id="btnOut">退出登录</button>
  </div>
  <div class="twrap">
    <table>
      <thead><tr><th>#</th><th>账号</th><th>UID</th><th>绑定歌曲</th><th>入池日期</th><th>通知邮箱</th><th>标记</th></tr></thead>
      <tbody id="tb"></tbody>
    </table>
  </div>
  <p class="tip" style="margin:12px 0 0">改绑歌曲 / 删除账号 / 换 CK 等写操作请在本地跑「号池管理.bat」，本后台只读，防止误操作。</p>
</div>

<script>
var POOL=[],STATS={};
function $(id){return document.getElementById(id);}
function msg(t,ok){var m=$('lm');m.textContent=t;m.className='msg'+(ok?' ok':' err');}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function login(){
  var p=$('pw').value.trim();
  if(!p){msg('请输入管理密码');return;}
  $('btn').disabled=true;
  fetch('/api/pool',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:p})})
  .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
  .then(function(o){
    $('btn').disabled=false;
    if(!o.ok){msg(o.d.message||'管理密码错误');return;}
    try{localStorage.setItem('poolAdminPass',p);}catch(e){}
    POOL=o.d.entries||[];STATS=o.d.stats||{};
    $('loginBox').hidden=true;$('mainBox').hidden=false;
    render();
  }).catch(function(){ $('btn').disabled=false; msg('网络错误，请重试'); });
}
$('btn').onclick=login;
$('pw').onkeydown=function(e){if(e.key==='Enter')login();};
$('btnOut').onclick=function(){try{localStorage.removeItem('poolAdminPass');}catch(e){}location.reload();};
$('btnRefresh').onclick=function(){fetchPool();};
$('q').oninput=render;
$('btnCopy').onclick=function(){
  var noMail=POOL.filter(function(e){return !e.email;});
  if(!noMail.length){alert('全部已绑定邮箱');return;}
  var txt='请以下成员到登记页绑定通知邮箱（账号异常时邮件通知本人）：\\n'+noMail.map(function(e){return e.name;}).join('\\n');
  function done(){$('btnCopy').textContent='已复制 '+noMail.length+' 条';setTimeout(function(){$('btnCopy').textContent='复制未绑邮箱名单';},2500);}
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(done,function(){fallback();});}else fallback();
  function fallback(){var ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');done();}catch(e){alert('复制失败，请手动选择');}document.body.removeChild(ta);}
};
$('btnCsv').onclick=function(){
  var rows=[['序号','账号','UID','歌曲ID','入池日期','邮箱','标记']];
  POOL.forEach(function(e,i){rows.push([i+1,e.name,e.uid||'',e.song||'',e.added||'',e.email||'',e.marks||'']);});
  var csv='\ufeff'+rows.map(function(r){return r.map(function(v){return '"'+String(v).replace(/"/g,'""')+'"';}).join(',');}).join('\\r\\n');
  var a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download='号池_'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
};
function fetchPool(){
  var p='';try{p=localStorage.getItem('poolAdminPass')||'';}catch(e){}
  if(!p){$('loginBox').hidden=false;$('mainBox').hidden=true;return;}
  fetch('/api/pool',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:p})})
  .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
  .then(function(o){
    if(!o.ok){msg(o.d.message||'请重新登录');$('loginBox').hidden=false;$('mainBox').hidden=true;return;}
    POOL=o.d.entries||[];STATS=o.d.stats||{};render();
  }).catch(function(){});
}
function badges(e){
  var h='';
  if(e.noListen)h+='<span class="badge b-red">只收</span>';
  if(!e.song)h+='<span class="badge b-gray">公益</span>';
  if(!e.email)h+='<span class="badge b-yellow">无邮箱</span>';
  if(String(e.name).indexOf('manual:')===0)h+='<span class="badge b-gray">手动</span>';
  return h||'<span style="color:#bbb">正常</span>';
}
function render(){
  var q=($('q').value||'').trim().toLowerCase();
  var list=POOL.filter(function(e){
    if(!q)return true;
    return (e.name+' '+(e.email||'')+' '+(e.uid||'')+' '+(e.song||'')).toLowerCase().indexOf(q)>=0;
  });
  $('stats').innerHTML=
    '<div class="stat"><b>'+STATS.total+'</b><span>号池总数</span></div>'
   +'<div class="stat"><b>'+STATS.withMail+'</b><span>已绑邮箱</span></div>'
   +'<div class="stat'+(STATS.noMail?' warn':'')+'"><b>'+STATS.noMail+'</b><span>未绑邮箱</span></div>'
   +'<div class="stat'+(STATS.noListen?' warn':'')+'"><b>'+STATS.noListen+'</b><span>只收号</span></div>'
   +'<div class="stat"><b>'+STATS.public+'</b><span>公益号</span></div>'
   +'<div class="stat"><b>'+(STATS.limit||200)+'</b><span>人数上限</span></div>'
   +'<div class="stat'+(STATS.remain<=20?' warn':'')+'"><b>'+STATS.remain+'</b><span>剩余名额</span></div>'
   +'<div class="stat"><b>'+(list.length)+'</b><span>当前筛选</span></div>';
  var h='';
  list.forEach(function(e,i){
    var song=e.song?'<a class="song" target="_blank" href="https://music.163.com/song?id='+e.song+'">'+e.song+'</a>':'<span style="color:#bbb">—</span>';
    h+='<tr><td class="num">'+(i+1)+'</td><td>'+esc(e.name)+'</td><td class="num">'+esc(e.uid)+'</td><td class="num">'+song+'</td><td class="num">'+esc(e.added)+'</td><td>'+esc(e.email||'—')+'</td><td>'+badges(e)+'</td></tr>';
  });
  $('tb').innerHTML=h||'<tr><td colspan="7" style="text-align:center;color:#999;padding:20px">没有匹配的账号</td></tr>';
}
try{ if(localStorage.getItem('poolAdminPass')) fetchPool(); }catch(e){}
</script>
</body>
</html>`;


addEventListener('fetch', (event) => {
  event.respondWith(handle(event.request).catch(e => new Response(JSON.stringify({ message: '服务器内部错误：' + ((e && e.message) || e) }), { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } })));
});

#!/bin/bash
# Apply patch for @4mica/sdk BLS Fp2 property access bug
# The SDK's bls.js uses affine.x.c (non-existent) instead of [affine.x.c0, affine.x.c1]
# This patch fixes signatureToWords() to work with all versions of @noble/curves

PATCH_TARGET="node_modules/@4mica/sdk/dist/bls.js"

if [ ! -f "$PATCH_TARGET" ]; then
  echo "SDK not installed, skipping patch"
  exit 0
fi

# Check if already patched
if grep -q "affine.x.c0" "$PATCH_TARGET"; then
  echo "@4mica/sdk bls.js already patched"
  exit 0
fi

# Apply the fix: replace affine.x.c with [affine.x.c0, affine.x.c1]
sed -i 's/const \[x0, x1\] = affine\.x\.c;/const [x0, x1] = [affine.x.c0, affine.x.c1];/' "$PATCH_TARGET"
sed -i 's/const \[y0, y1\] = affine\.y\.c;/const [y0, y1] = [affine.y.c0, affine.y.c1];/' "$PATCH_TARGET"

echo "@4mica/sdk bls.js patched: fixed Fp2 property access (.c0/.c1 instead of .c)"

<?php
// PayFast's documented PHP reference functions, used by payfast.test.js to prove the Node code signs identically.
function generateSignature($data, $passPhrase = null) {
    $pfOutput = '';
    foreach ($data as $key => $val) { if ($val !== '') { $pfOutput .= $key . '=' . urlencode(trim($val)) . '&'; } }
    $getString = substr($pfOutput, 0, -1);
    if ($passPhrase !== null) { $getString .= '&passphrase=' . urlencode(trim($passPhrase)); }
    return md5($getString);
}
function generateApiSignature($pfData, $passPhrase = null) {
    if ($passPhrase !== null) { $pfData['passphrase'] = $passPhrase; }
    ksort($pfData);
    return md5(http_build_query($pfData));
}
function itnParamString($pfData) {
    $s = '';
    foreach ($pfData as $k => $v) { if ($k !== 'signature') { $s .= $k . '=' . urlencode($v) . '&'; } else { break; } }
    return substr($s, 0, -1);
}
$in = json_decode(stream_get_contents(STDIN), true);
switch ($in['fn']) {
  case 'urlencode': echo json_encode(array_map('urlencode', $in['values'])); break;
  case 'sig': echo generateSignature($in['data'], $in['pass']); break;
  case 'api': echo generateApiSignature($in['data'], $in['pass']); break;
  case 'itn': echo md5(itnParamString($in['data']) . '&passphrase=' . urlencode(trim($in['pass']))); break;
}

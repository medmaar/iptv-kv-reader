#!/bin/bash
# For each static order page: does the live HTML carry the invoice.js tag? (plain and cache-busted)
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36"
for u in \
  https://mojo4ktv.com/12-months-1-device https://buyiptvnorway.com/iptv-12-months-1-connection \
  https://norgesiptv.com/bestill.html https://flimmerkanal.de/plan/iptv-12-monate-1-verbindung \
  https://iptvv.de/iptv-kaufen-1-geraet-1-jahr https://mojo4k.de/1-jahr-1-gerat \
  https://streamdeutschland.de/iptv-kaufen-1-geraet-1-jahr https://mojo4k.fr/order.html https://iptvmojo.com/iptv-12-months-1-connection; do
  plain=$(curl -sL -A "$UA" "$u" | grep -c "invoice.js")
  bust=$(curl -sL -A "$UA" "$u?nocache=$RANDOM" | grep -c "invoice.js")
  hdr=$(curl -sIL -A "$UA" "$u" | grep -iE "^(age|cf-cache-status|cache-control|last-modified|etag|server|x-served-by|via):" | tr '\r\n' ' ')
  echo "$u plain=$plain busted=$bust | $hdr"
done
for w in iptv-trial-mojo4ktv iptv-trial-flimmerkanal iptv-trial-mojo4kfr; do echo "$w invoice.js: $(curl -s -o /dev/null -w '%{http_code}' https://$w.medmaar.workers.dev/invoice.js)"; done
echo "streambleu bundle has worker url: $(curl -sL -A "$UA" https://streambleu.fr/tarifs/12-mois | grep -o '_next/static/[^"]*\.js' | sort -u | while read p; do curl -s https://streambleu.fr/$p; done | grep -c 'iptv-trial-streambleu.medmaar.workers.dev/invoice')"
echo "streambleu page has email input: $(curl -sL -A "$UA" https://streambleu.fr/tarifs/12-mois | grep -c 'type=\"email\"')"

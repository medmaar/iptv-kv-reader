#!/usr/bin/env bash
# Checks that each invoice email's header picture is served (status, type, size).
for u in https://iptv-trial-maple4k.medmaar.workers.dev/invoice/header.png?v=69a509aacf https://iptv-trial-maplehd.medmaar.workers.dev/invoice/header.png?v=fe0204ac61 https://iptv-trial-iptvmojo.medmaar.workers.dev/invoice/header.png?v=80341859db https://iptv-trial-mojo4ktv.medmaar.workers.dev/invoice/header.png?v=a4accdc4e2 https://iptv-trial-buyiptvnorway.medmaar.workers.dev/invoice/header.png?v=4baf3db1b5 https://iptv-trial-iptvvde.medmaar.workers.dev/invoice/header.png?v=1678420077 https://iptv-trial-mojo4kde.medmaar.workers.dev/invoice/header.png?v=2808f450ab https://iptv-trial-streamdeutschland.medmaar.workers.dev/invoice/header.png?v=7abbaf3f65 https://mojo4k.uk/brand/invoice-header.png?v=1daad6416a; do
  printf '%s  %s\n' "$(curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download}' "$u")" "$u"
done

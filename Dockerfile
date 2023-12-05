FROM denoland/deno:ubuntu-1.37.1

WORKDIR /app

# update the apt-get catalog
RUN apt-get update \
  # headless install with --assume-yes flag
  && apt-get --assume-yes install \
  # install usb utils
  usbutils \
  # install print utilities
  cups-client \
  # driver package specifically for the dymo
  printer-driver-dymo

# The port that your application listens to.
EXPOSE 4000

# Prefer not to run as root.
USER deno

# Cache the dependencies as a layer (the following two steps are re-run only when deps.ts is modified).
# Ideally cache deps.ts will download and compile _all_ external files used in main.ts.
# COPY deps.ts .
# RUN deno cache deps.ts

# These steps will be re-run upon each file change in your working directory:
COPY . .
# Compile the main app so that it doesn't need to be compiled each startup/entry.
RUN deno cache src/main.ts

CMD ["run", "--allow-net", "--allow-run", "--allow-write", "src/main.ts"]

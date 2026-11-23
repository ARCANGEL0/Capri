# Capri Runtime

The runtime is the small machine-side bridge that gives the Capri companion app access to local coding-agent sessions.

## Install

On a Tailscale-connected Linux or macOS machine, run:

```sh
curl -fsSL https://raw.githubusercontent.com/ARCANGEL0/Capri/main/runtime/setup_install.sh | bash
```

The installer downloads the bridge from `runtime/capri_runtime_server.py`, creates the `capri-runtime` service, configures Tailscale Serve on port `8447`, and prints the endpoint and generated token for Capri Setup.

Run it as the same user who owns the coding-agent sessions. The agent binaries must already be installed and authenticated for that user.

## Service names

- Linux: `capri-runtime.service`
- macOS: `com.arcxlo.capri-runtime` launch agent

The bridge listens only on its configured localhost port (`7788` by default). Tailscale Serve is the private HTTPS edge; the service is not opened to the public network.

## Useful commands

```sh
sudo systemctl status capri-runtime
tailscale serve status
```

The installer accepts `CAPRI_TOKEN`, `CAPRI_DEVICE`, `CAPRI_USER`, `CAPRI_SKIP_SERVE=1`, and `CAPRI_RAW_BASE` overrides.

## Pairing status command

The installer also adds a `capri-runtime` command to the service owner's local bin, or `/usr/local/bin` for a system install. Run it without arguments to print a framed status card containing the service state, device label, Tailscale HTTPS endpoint, local port, and pairing token:

```sh
capri-runtime
```

Use `capri-runtime --help` for the short usage line.

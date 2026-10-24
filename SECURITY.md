# Security

## Reporting a problem with whatsallowed itself

If What's Allowed makes a network call, writes outside its baseline file, prints a full secret, or can be made to run code, please open a private security advisory on the repository rather than a public issue.

## Missed or wrong findings

A risky setting it misses, or a false alarm, isn't a security issue in the tool. Open a normal issue with a minimal config that shows it (with any secrets replaced), and it can become a labelled case.

## What it isn't

whatsallowed is a configuration check, not a security assessment, audit or certification. A clean result doesn't mean a setup is safe. Its measured accuracy and known misses are in [docs/ACCURACY.md](docs/ACCURACY.md).

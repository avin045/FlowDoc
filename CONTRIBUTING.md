# Contributing to FlowDoc

Thanks for helping. FlowDoc is maintained by one person, so a little preparation makes it much easier to accept your change.

## Before you start

- **Bugs:** open an issue with your FlowDoc version, your Windows or Linux version, whether you used the desktop app or the extension, and the steps to reproduce it.
- **Larger changes or new features:** open an issue first to discuss the idea, so you don't spend time on something that won't be merged.
- **Security problems:** don't open a public issue. Follow [SECURITY.md](SECURITY.md) instead.

## Making a change

1. Fork the repository and create a branch for your change.
2. Set up the project as described in [docs/developers.md](docs/developers.md).
3. Make your change. Keep it focused on one thing.
4. Run both test suites and make sure they pass:

   ```bash
   npm test
   ```

   ```bash
   npm run test:desktop
   ```

5. Open a pull request that explains what changed and why.

## Style

- Write docs and user-facing text in plain English: short sentences, no jargon a non-technical user wouldn't know.
- Use the name **FlowDoc** only. Don't use the project's old product name in new code, text or metadata. The compatibility code that reads data saved by older versions stays as it is.
- User documentation goes in [docs/user-guide.md](docs/user-guide.md); build and code documentation goes in [docs/developers.md](docs/developers.md).

## License

By contributing, you agree that your contribution is licensed under the [Apache License 2.0](LICENSE), the same license as the rest of FlowDoc.

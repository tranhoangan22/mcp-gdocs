# Contributing to mcp-gdocs

Thank you for your interest in contributing to mcp-gdocs! This document provides guidelines for contributing to the project.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/mcp-gdocs.git`
3. Install dependencies: `npm install`
4. Create a branch for your changes: `git checkout -b feature/your-feature-name`

## Development Setup

### Prerequisites

- Node.js 18+
- AWS CLI configured with credentials
- Google Cloud project with Docs and Drive APIs enabled

### Running Locally

```bash
# Install dependencies
npm install

# Type check
npm run typecheck

# Lint
npm run lint

# Build
npm run build
```

## Code Style

This project uses [Biome](https://biomejs.dev/) for linting and formatting. Before submitting a PR:

```bash
# Check for issues
npm run lint

# Auto-fix issues
npm run lint:fix
```

## Pull Request Process

1. Ensure your code passes linting and type checking
2. Update documentation if you're adding or changing features
3. Keep PRs focused - one feature or fix per PR
4. Write clear commit messages describing what changed and why

## Reporting Issues

When reporting issues, please include:

- A clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Node.js version and OS
- Relevant error messages or logs

## Security

If you discover a security vulnerability, please do NOT open a public issue. Instead, email the maintainer directly.

## Questions?

Feel free to open an issue for questions about contributing.

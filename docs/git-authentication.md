# Git authentication on a Factoru factory

Factoru Server clones remote project repositories into that project's managed
`$HOME/factoru-projects/<project>/repositories/` directory. Git access must
therefore work for the unprivileged operating-system account that runs
`factoru-server`, on the factory that will own the project. Desktop never sends
Git credentials to a factory, and Factoru does not store private keys or access
tokens in its database.

Before Desktop accepts a repository URL, Server runs a bounded,
non-interactive `git ls-remote` check. Project creation repeats that check
before persisting any project state. Diagnose the exact same path directly on
the factory with:

```sh
factoru-server repositories check --url git@github.com:OWNER/REPOSITORY.git
factoru-server repositories check --url https://gitlab.com/OWNER/REPOSITORY.git --json
```

The check honors the server account's normal `~/.ssh/config`, `known_hosts`,
`SSH_AUTH_SOCK`, and Git credential helpers. It never prompts, accepts a host
key, or rewrites Git configuration.

## One SSH identity per provider

Create or copy each private key directly on the factory and register its public
key with the matching provider account. Keep the SSH directory private:

```sh
chmod 700 ~/.ssh
chmod 600 ~/.ssh/config ~/.ssh/github_id ~/.ssh/gitlab_id
```

Map each provider in `~/.ssh/config`:

```sshconfig
Host github.com
  User git
  IdentityFile ~/.ssh/github_id
  IdentitiesOnly yes

Host gitlab.com
  User git
  IdentityFile ~/.ssh/gitlab_id
  IdentitiesOnly yes
```

URLs can then use the normal provider host:

```text
git@github.com:OWNER/REPOSITORY.git
git@gitlab.com:GROUP/REPOSITORY.git
```

## Multiple accounts or keys on the same provider

OpenSSH selects identities by host name. Give each account a local alias that
points to the real provider:

```sshconfig
Host github-personal
  HostName github.com
  User git
  IdentityFile ~/.ssh/github_personal
  IdentitiesOnly yes

Host github-work
  HostName github.com
  User git
  IdentityFile ~/.ssh/github_work
  IdentitiesOnly yes
```

Use that alias in the repository URL so Git selects the intended key:

```text
git@github-personal:PERSONAL_OWNER/REPOSITORY.git
git@github-work:WORK_ORG/REPOSITORY.git
```

The same pattern works for GitLab and self-hosted Git services. Factoru keeps
the alias in the repository source URL but never reads or returns the private
key.

## Host-key verification

Factoru never sets `StrictHostKeyChecking=no` and never accepts an unknown host
automatically. Establish the SSH connection interactively as the server user,
compare the displayed fingerprint with the provider's independently published
fingerprint, and accept it only after it matches. Do not blindly pipe
`ssh-keyscan` output into `known_hosts`.

If a provider legitimately rotates a host key, verify the new fingerprint
before changing `known_hosts`. A changed-key warning is treated as a hard
failure.

## Passphrase-protected keys and ssh-agent

Load passphrase-protected keys into an agent before starting Factoru Server:

```sh
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/github_work
factoru-server repositories check --url git@github-work:WORK_ORG/REPOSITORY.git
```

The `factoru-server` process must inherit that `SSH_AUTH_SOCK`. A tmux session
started from the same environment normally does. Managed-service installation
is unfinished; when it arrives, its service account and credential lifecycle
must be configured explicitly rather than assuming an interactive agent.

## HTTPS repositories

HTTPS access uses the server account's existing Git credential helper. Use the
provider's supported token or credential flow; never put a username, token, or
password in the repository URL. For multiple accounts on one HTTPS host,
configure Git to include the repository path when selecting credentials:

```sh
git config --global credential.useHttpPath true
```

Choose an appropriate secure credential helper for the server operating
system. Factoru disables interactive credential prompts, so an unconfigured or
expired helper fails immediately with an actionable Desktop message.

## Recovery

If access fails before project creation, Desktop keeps the project form and its
repository selections open. Fix access on the named factory, run the CLI check,
and add or create again.

A permission, network, or storage change can still break the later clone. In
that case the project remains durable in **Repository setup needs attention**.
Fix the factory, verify the URL with the CLI, and choose **Retry repository
setup**. Cached project data remains readable while the factory is offline, but
validation and retry require a live factory connection.

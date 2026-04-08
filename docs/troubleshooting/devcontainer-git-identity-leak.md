# devcontainer 経由で git identity がダミー値に書き換わる問題

**日付**: 2026-04-09
**ステータス**: 解決済み
**影響コミット**: `4ebed95` 以降の5コミット（現在は `Yuma Ohno (Yono1112)` に修正済み）

## 症状

devcontainer 内でコミットすると、作者が `Kondate Agent Dev <dev@kondate-agent.local>` というダミー値になる。ホスト側で `git config --global user.name` を設定しても効かない。

## 根本原因

**リポジトリローカルの `.git/config` にダミー値が書き込まれており、グローバル設定を上書きしていた。**

```ini
[user]
  email = dev@kondate-agent.local
  name = Kondate Agent Dev
```

### なぜダミー値が書き込まれたか

devcontainer 内で何者か（おそらく Claude Code harness が「git identity が無いとコミットできない」ときのフォールバック挙動）が、以下のようなコマンドを実行したと推定される:

```bash
git config user.name "Kondate Agent Dev"
git config user.email "dev@kondate-agent.local"
```

`--global` が付いていないため **リポジトリローカルの `.git/config` に書き込まれる**。

### なぜホストのグローバル設定で上書きできなかったか

`.devcontainer/devcontainer.json` の設定:

```json
"workspaceMount": "source=${localWorkspaceFolder},target=/workspace,type=bind,consistency=delegated"
```

**`workspaceMount` がホストとコンテナで bind mount** のため、`.git/config` ファイルはホストとコンテナで**同一ファイル**。

つまり:
1. コンテナ内で `git config user.name` が実行されると `.git/config` に書き込まれる
2. bind mount なのでホスト側の `.git/config` にも同じ内容が反映される
3. コンテナを抜けた後もホスト側のこのリポジトリには設定が残る
4. git の設定優先順位は「ローカル > グローバル」なので、ホストで `git config --global` を設定してもこのリポジトリでは勝てない

## 確認コマンド

```bash
# リポジトリローカルの設定を確認
cat .git/config | grep -A 2 user

# 出力例（問題があった時）
# [user]
#   email = dev@kondate-agent.local
#   name = Kondate Agent Dev
```

## 対症療法（今回実施）

### 1. リポジトリローカルの user セクションを削除

```bash
git config --remove-section user
# または個別に
git config --unset user.name
git config --unset user.email
```

これで以降のコミットはホストのグローバル設定を使う。

### 2. 既にダミー値で作られた過去コミットを書き換え

`git filter-branch --env-filter` で過去コミットの作者情報を書き換え:

```bash
git filter-branch -f --env-filter '
export GIT_AUTHOR_NAME="Yuma Ohno (Yono1112)"
export GIT_AUTHOR_EMAIL="<正しいメール>"
export GIT_COMMITTER_NAME="Yuma Ohno (Yono1112)"
export GIT_COMMITTER_EMAIL="<正しいメール>"
' <書き換え開始コミット>..HEAD
```

その後 `git push --force-with-lease origin main` で反映。

### 3. パブリックリポジトリの場合はメール漏洩対策も必要

今回のリポジトリはパブリックなので、実メールを GitHub noreply メールに変更:

1. GitHub https://github.com/settings/emails で:
   - ✅ "Keep my email addresses private"
   - ✅ "Block command line pushes that expose my email"
2. noreply メール（`<数字ID>+<username>@users.noreply.github.com`）を取得
3. リポジトリローカル config に設定:
   ```bash
   git config user.email "<数字ID>+<username>@users.noreply.github.com"
   ```

**注意**: 過去コミットに既に実メールが入っている場合、完全に消すには全履歴書き換え + force push が必要。ただし GitHub のキャッシュ・forks・スクレイパーに残る可能性があり、完全秘匿は困難。今回は「今後のコミットだけ noreply 化」で割り切った。

## 恒久対策（実施済み）

### devcontainer.json にホストの `~/.gitconfig` を read-only bind mount

コミット `1599a3b` で `.devcontainer/devcontainer.json` に以下を追加:

```json
"mounts": [
  "source=claude-code-bashhistory-${devcontainerId},target=/commandhistory,type=volume",
  "source=claude-code-config-${devcontainerId},target=/home/node/.claude,type=volume",
  "source=${localEnv:HOME}/.gitconfig,target=/home/node/.gitconfig,type=bind,readonly"
]
```

**効果**:
- ホストの `~/.gitconfig` がコンテナ内の `/home/node/.gitconfig` として参照される
- コンテナ内で git が identity を自動取得できるので、ダミー値の書き込みが発生しない
- `readonly` なのでコンテナ側からの上書きも防止

### 残存リスク

- bind mount された `.git/config` 自体は引き続きホストと共有される
- もし Claude Code harness が将来的に再び `git config user.name` を実行する挙動を復活させた場合、ローカル config 経由で再発する可能性あり
- 本質的な防御は「GitHub 側の Block pushes that expose my email 設定」。これが有効なら万一ダミーや実メールで push しようとしても弾かれる

## 教訓

1. **`workspaceMount` の bind mount は `.git/config` まで共有してしまう** — コンテナ内でローカル git config を変更すると永続化する
2. **`git config` は `--global` を付けないとローカルに書かれる** — devcontainer/CI スクリプトでの設定には要注意
3. **パブリックリポジトリでは最初から noreply メール運用** — 漏れてからの修復は困難
4. **GitHub の "Block command line pushes that expose my email" 設定は必須の二重防御**

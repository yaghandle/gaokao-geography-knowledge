# 高中地理知识库发布站

这是从 Obsidian 知识库生成的静态发布站，只读取以下公开范围：

- `02_核心笔记/高中地理知识库`
- `03 _ 编译维基(wiki)/高中知识卡片/地理`

不会发布 `01_原始资料(raw)`、`05_AI工作区` 的临时文件、脚本、证件照、日记和 Obsidian 本地状态。

## 本地构建

```powershell
npm run build
npm run serve
```

打开：

```text
http://127.0.0.1:4173
```

## 当前构建内容

- 核心笔记：303 篇
- 普通知识卡片：433 张
- 专题入口：18 个
- 高考题卡：952 张
- 已复制图片：901 个

## GitHub Pages 部署

当前环境无法解析 `github.com` 时，自动部署会失败。网络恢复后在 `dist` 目录执行：

```powershell
gh auth login -h github.com -w
gh repo create yaghandle/gaokao-geography-knowledge --public --source . --push
gh api -X POST repos/yaghandle/gaokao-geography-knowledge/pages -f source.branch=master -f source.path=/
```

发布后访问：

```text
https://yaghandle.github.io/gaokao-geography-knowledge/
```

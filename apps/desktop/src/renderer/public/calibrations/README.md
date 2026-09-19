# 共享标定包

把导出的标定包重命名为 `default.json` 放在这个目录里，应用在**本机没有该图标定**时会自动使用它。

这样做的好处：标定一次、导出一份、提交到仓库，任何人 clone 下来打开就是标好的（不用自己标）。

生成方式：应用 → 标定面板 → 「导出标定包」→ 把文件复制到这里并改名 `default.json`。

格式（由应用导出的就是它）：

```json
{
  "version": 1,
  "exportedAt": 1758240000000,
  "calibrations": {
    "customs": { "mapId": "customs", "image": {}, "rotation": 0, "controlPoints": [], "source": {} }
  }
}
```

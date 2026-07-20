---
layout: article
title: QML 语法与实战指南：从声明式界面到 C++ 集成
description: 系统讲解 Qt 6 QML 的对象、属性绑定、信号、组件、布局、模型视图、动画、模块化和 C++ 交互，并附完整工程示例。
date: 2026-07-20
category: Qt 工具
tags:
  - Qt 6
  - QML
  - Qt Quick
  - C++
---

# QML 语法与实战指南：从声明式界面到 C++ 集成

QML 是 Qt 的声明式语言，主要用来构建桌面、移动端和嵌入式界面。它描述“界面由哪些对象组成，以及对象之间如何关联”，而不是逐条命令系统创建控件。

> 学习 QML 最重要的三个抓手：用对象树表达结构，用属性绑定表达状态关系，用信号表达事件。

本文以 Qt 6 的现代写法为主。旧版 Qt 5 项目常在 `import` 后写版本号，核心概念仍然相通。

## 1. 第一个 QML 页面

```qml
import QtQuick
import QtQuick.Controls

ApplicationWindow {
    width: 800
    height: 600
    visible: true
    title: "QML Demo"

    Button {
        anchors.centerIn: parent
        text: "点击我"

        onClicked: {
            console.log("按钮被点击")
        }
    }
}
```

可以把这段代码理解为一个对象树：根对象是窗口，窗口中包含按钮；`width`、`text` 是属性，`onClicked` 是信号处理器。

一个普通 QML 文件只有一个根对象。文件通常由 `pragma`（可选）、`import` 和根对象三部分组成。

## 2. import 与对象声明

模块导入的通用形式是：

```qml
import ModuleIdentifier [Version.Number] [as Qualifier]
```

常见导入：

```qml
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
```

使用别名可以避免命名冲突：

```qml
import QtQuick.Controls as Controls

Controls.Button {
    text: "确定"
}
```

对象声明的基本格式是：

```qml
TypeName {
    propertyName: value
}
```

例如：

```qml
Rectangle {
    width: 240
    height: 120
    radius: 8
    color: "steelblue"

    Text {
        anchors.centerIn: parent
        text: "Hello QML"
        color: "white"
    }
}
```

内层 `Text` 会进入外层对象的默认属性。对 `Item` 等可视对象来说，它通常会成为可视子项。

## 3. id 与对象引用

`id` 用于在当前组件中引用对象：

```qml
Rectangle {
    id: panel
    width: 300
    height: 200

    Text {
        text: "父对象宽度：" + panel.width
    }
}
```

需要牢记：

- `id` 不是普通属性，不能通过 `panel.id` 读取。
- 一个组件实例中的 `id` 必须唯一。
- `id` 保存对象引用，不是字符串。
- 建议以小写字母开头，例如 `submitButton`。
- 访问外层或兄弟对象时，优先使用 `root.count` 这类显式限定写法。

## 4. 属性系统

### 4.1 自定义属性

```qml
Item {
    property string username: "Vincent"
    property int age: 20
    property real progress: 0.75
    property bool loggedIn: false
    property color accentColor: "#2563eb"
    property url avatarUrl: "images/avatar.png"
    property var metadata: ({ role: "admin", score: 100 })
}
```

常见类型：

| 类型 | 典型用途 |
|---|---|
| `bool` | 布尔状态 |
| `int` | 整数 |
| `real`、`double` | 浮点数 |
| `string` | 文本 |
| `url` | 文件或资源地址 |
| `color` | 颜色 |
| `date` | 日期时间 |
| `point`、`size`、`rect` | 几何数据 |
| `var` | 动态 JavaScript 值 |
| `list<T>` | 类型化对象列表 |
| QML 类型名 | 对象引用 |

能确定类型时不要滥用 `var`，明确类型更利于编辑器、`qmllint` 和 QML 编译器检查。

### 4.2 readonly、required 与 alias

只读属性：

```qml
readonly property string fullName: firstName + " " + lastName
```

必需属性用于声明组件输入契约：

```qml
required property string username
required property url avatar
```

使用该组件时必须给它们赋值，否则组件创建失败。

属性别名把组件接口连接到内部属性：

```qml
Row {
    property alias text: input.text
    property alias label: title.text

    Text { id: title }
    TextField { id: input }
}
```

`alias` 不是复制值，而是直接引用目标属性。只应暴露稳定的公共接口，避免把所有内部实现都泄露出去。

## 5. 属性绑定

属性绑定是 QML 最核心的能力：

```qml
Rectangle {
    width: parent.width * 0.8
    height: width / 2
}
```

这不是一次性计算。当 `parent.width` 变化时，`width` 会重新计算；`width` 变化后，`height` 也随之更新。

绑定可以包含条件表达式：

```qml
Text {
    text: enabled ? "已启用" : "已禁用"
    color: value >= 0 ? "green" : "red"
}
```

复杂表达式可以使用代码块，但必须返回结果：

```qml
Text {
    text: {
        if (score >= 90)
            return "优秀"
        if (score >= 60)
            return "及格"
        return "不及格"
    }
}
```

### 5.1 命令式赋值会覆盖绑定

```qml
Rectangle {
    id: box
    width: parent.width / 2

    Component.onCompleted: {
        box.width = 100
    }
}
```

执行 `box.width = 100` 后，原来的宽度绑定通常被移除。需要重新建立绑定时：

```qml
box.width = Qt.binding(function() {
    return box.parent.width / 2
})
```

条件绑定可以使用 `Binding`：

```qml
Binding {
    target: box
    property: "width"
    value: box.parent.width / 2
    when: autoResize
}
```

### 5.2 避免绑定循环和副作用

不要让两个属性互相决定：

```qml
// 错误风险：循环依赖
width: height * 2
height: width / 2
```

绑定表达式可能执行多次，因此不要在绑定里修改其他状态、发送网络请求或执行计数等副作用。

## 6. 分组属性与附加属性

分组属性属于对象自身：

```qml
Text {
    font {
        family: "Microsoft YaHei"
        pixelSize: 20
        bold: true
    }
}
```

等价于设置 `font.family`、`font.pixelSize` 和 `font.bold`。

附加属性由另一个类型提供：

```qml
ColumnLayout {
    Button {
        text: "确定"
        Layout.fillWidth: true
        Layout.preferredHeight: 48
    }
}
```

这里的 `Layout.fillWidth` 由布局系统附加给子对象。`Component.onCompleted`、`Keys.onPressed` 也是常见附加信号处理器。

## 7. 信号与事件

处理已有信号：

```qml
Button {
    text: "保存"

    onClicked: {
        console.log("开始保存")
    }
}
```

自定义信号：

```qml
Item {
    signal submitted(string text)
    signal canceled()

    Button {
        text: "提交"
        onClicked: submitted("表单内容")
    }
}
```

外部处理信号：

```qml
MyForm {
    onSubmitted: (text) => {
        console.log("收到：", text)
    }
}
```

带参数的处理器推荐显式声明参数。每个普通属性通常还会自动产生变化信号：

```qml
Item {
    property int count: 0

    onCountChanged: {
        console.log("count =", count)
    }
}
```

动态监听外部对象可以使用 `Connections`：

```qml
Connections {
    target: backend

    function onDataReceived(data) {
        console.log("收到数据：", data)
    }
}
```

## 8. 方法与 JavaScript

QML 对象可以定义 JavaScript 方法：

```qml
Item {
    function add(a: int, b: int): int {
        return a + b
    }

    Component.onCompleted: console.log(add(3, 4))
}
```

JavaScript 对象字面量通常写成：

```qml
property var user: ({ name: "Alice", age: 20 })
property var values: [10, 20, 30]
```

复杂的纯函数可以放进外部 JavaScript 文件，但大量业务状态、网络、数据库和多线程逻辑更适合放在 C++ 后端。

## 9. 可视对象与布局

`Item` 是大多数 Qt Quick 可视类型的基础类型，但它本身不绘制内容。常用类型包括 `Rectangle`、`Text`、`Image`、`Flickable`、`ListView` 和 `Loader`。

### 9.1 Anchors

```qml
Rectangle {
    anchors {
        fill: parent
        margins: 16
    }
}
```

常用锚点有 `left`、`right`、`top`、`bottom`、`horizontalCenter`、`verticalCenter`、`centerIn` 和 `fill`。

不要让 `x` 与 `anchors.left` 同时控制水平方向，也不要让 `y` 与 `anchors.top` 同时控制垂直方向。

### 9.2 Row、Column 与 Grid

适合按照子项已有尺寸简单排列：

```qml
Row {
    spacing: 12
    Button { text: "保存" }
    Button { text: "取消" }
}
```

### 9.3 Layout

适合响应式空间分配：

```qml
RowLayout {
    anchors.fill: parent
    spacing: 12

    TextField {
        Layout.fillWidth: true
        placeholderText: "搜索"
    }

    Button {
        text: "搜索"
        Layout.preferredWidth: 100
    }
}
```

被 Layout 管理的子对象，不要再用 `anchors.fill` 或 `x/y` 控制相同方向的几何关系。

## 10. Qt Quick Controls

`QtQuick.Controls` 提供 `ApplicationWindow`、`Button`、`Label`、`TextField`、`TextArea`、`CheckBox`、`ComboBox`、`Slider`、`Dialog`、`Menu`、`StackView` 等常用控件。

```qml
ApplicationWindow {
    visible: true

    Column {
        TextField { placeholderText: "用户名" }
        CheckBox { text: "记住我" }
        Slider { from: 0; to: 100; value: 50 }
        Button { text: "登录" }
    }
}
```

实际项目应在基础控件上封装统一的颜色、尺寸、状态和交互，而不是在每个页面复制样式。

## 11. 自定义组件

首字母大写的 QML 文件会定义一个可复用类型。

`PrimaryButton.qml`：

```qml
import QtQuick
import QtQuick.Controls

Button {
    id: root

    required property string label
    signal accepted()

    text: root.label
    onClicked: root.accepted()
}
```

使用组件：

```qml
PrimaryButton {
    label: "提交"
    onAccepted: console.log("提交成功")
}
```

一个清晰的组件接口通常包含：必需输入 `required property`、可选配置 `property`、只读输出 `readonly property`、事件 `signal` 和操作 `function`。

局部小类型可使用内联组件：

```qml
Item {
    component StatusBadge: Rectangle {
        required property string label
        required property color badgeColor

        width: labelItem.implicitWidth + 16
        height: 28
        radius: 14
        color: badgeColor

        Text {
            id: labelItem
            anchors.centerIn: parent
            text: label
        }
    }

    StatusBadge {
        label: "在线"
        badgeColor: "green"
    }
}
```

## 12. Component 与 Loader

`Component` 保存尚未实例化的对象定义：

```qml
Component {
    id: redBoxComponent

    Rectangle {
        width: 100
        height: 100
        color: "red"
    }
}

Loader {
    sourceComponent: redBoxComponent
}
```

也可以按文件动态加载：

```qml
Loader {
    source: "SettingsPage.qml"
    active: showSettings
}
```

这适合延迟创建较重页面、动态切换页面或减少首次启动对象数量。加载完成前，`Loader.item` 可能是 `null`。

## 13. 模型、视图与代理

QML 常见数据展示结构是 Model → View → Delegate。

```qml
ListView {
    width: 320
    height: 400
    model: ["Alice", "Bob", "Carol"]

    delegate: Rectangle {
        required property string modelData
        required property int index

        width: ListView.view.width
        height: 48
        color: index % 2 === 0 ? "#eeeeee" : "#ffffff"

        Text {
            anchors.centerIn: parent
            text: modelData
        }
    }
}
```

结构化数据可以使用 `ListModel`：

```qml
ListModel {
    id: userModel
    ListElement { name: "Alice"; age: 20 }
    ListElement { name: "Bob"; age: 25 }
}

ListView {
    model: userModel

    delegate: Row {
        required property string name
        required property int age
        spacing: 10

        Text { text: name }
        Text { text: age + " 岁" }
    }
}
```

大量、分页、数据库或实时数据通常应由 C++ `QAbstractListModel` 提供。delegate 可能按需创建、销毁或复用，持久业务状态应该保存在 model 中。

## 14. 状态与动画

状态用于集中描述一组属性变化：

```qml
Rectangle {
    id: card
    property bool selected: false

    state: selected ? "selected" : "normal"

    states: [
        State {
            name: "normal"
            PropertyChanges { target: card; color: "gray"; scale: 1.0 }
        },
        State {
            name: "selected"
            PropertyChanges { target: card; color: "dodgerblue"; scale: 1.1 }
        }
    ]

    transitions: Transition {
        NumberAnimation { properties: "scale"; duration: 200 }
        ColorAnimation { duration: 200 }
    }
}
```

属性每次变化时自动过渡可以使用 `Behavior`：

```qml
Behavior on width {
    NumberAnimation {
        duration: 250
        easing.type: Easing.OutCubic
    }
}
```

独立动画可以组合在 `SequentialAnimation` 或 `ParallelAnimation` 中。

## 15. 鼠标、触摸和键盘

Qt 6 中可使用 Pointer Handler：

```qml
Rectangle {
    width: 120
    height: 48
    color: tap.pressed ? "darkblue" : "blue"

    TapHandler {
        id: tap
        onTapped: console.log("tapped")
    }
}
```

经典项目中也常见 `MouseArea`：

```qml
MouseArea {
    anchors.fill: parent
    hoverEnabled: true

    onClicked: (mouse) => {
        console.log(mouse.x, mouse.y)
    }
}
```

键盘处理：

```qml
Item {
    focus: true

    Keys.onPressed: (event) => {
        if (event.key === Qt.Key_Escape) {
            console.log("Escape")
            event.accepted = true
        }
    }
}
```

复杂界面需要关注 active focus 传递，而不仅仅是设置 `focus: true`。

## 16. 生命周期与动态对象

```qml
Component.onCompleted: {
    console.log("对象创建完成")
}

Component.onDestruction: {
    console.log("对象即将销毁")
}
```

动态创建：

```qml
const object = component.createObject(parentObject, {
    x: 10,
    y: 20
})

if (object === null)
    console.error(component.errorString())
```

动态创建的对象可调用 `destroy()` 销毁。不要随意销毁由 C++ 或其他所有者管理的对象。

## 17. QML 与 C++ 的分工

常见架构是：QML 负责界面、交互和动画；C++ 负责网络、数据库、算法、线程、硬件和大型数据模型。

C++ 类型示例：

```cpp
#pragma once

#include <QObject>
#include <QtQml/qqmlregistration.h>

class Counter : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    Q_PROPERTY(int value READ value WRITE setValue NOTIFY valueChanged)

public:
    explicit Counter(QObject *parent = nullptr) : QObject(parent) {}

    int value() const { return m_value; }

    void setValue(int value)
    {
        if (m_value == value)
            return;
        m_value = value;
        emit valueChanged();
    }

    Q_INVOKABLE void increment()
    {
        setValue(m_value + 1);
    }

signals:
    void valueChanged();

private:
    int m_value = 0;
};
```

QML 中使用：

```qml
Counter { id: counter }

Text { text: counter.value }

Button {
    text: "+1"
    onClicked: counter.increment()
}
```

对应关系：

| C++ | QML 中的能力 |
|---|---|
| `Q_PROPERTY` | 可读取、赋值或绑定的属性 |
| `NOTIFY` signal | 属性变化通知 |
| `signals` | `onSignalName` 处理器 |
| `Q_INVOKABLE` / public slot | 可调用方法 |
| `Q_ENUM` | 枚举 |
| `QML_ELEMENT` | 注册为 QML 类型 |
| `QML_SINGLETON` | 注册为单例 |

会变化的 `Q_PROPERTY` 应提供正确的 `NOTIFY` 信号，否则 QML 绑定不知道何时更新。现代项目优先使用注册类型、单例或根组件的 required property；大量 context property 会形成隐式依赖，并且对静态工具不可见。

## 18. 最小 Qt 6 工程

目录结构：

```text
QmlDemo/
├── CMakeLists.txt
├── main.cpp
├── Main.qml
└── CounterButton.qml
```

`CMakeLists.txt`：

```cmake
cmake_minimum_required(VERSION 3.21)
project(QmlDemo LANGUAGES CXX)

find_package(Qt6 REQUIRED COMPONENTS Quick)
qt_standard_project_setup()

qt_add_executable(QmlDemo main.cpp)

qt_add_qml_module(QmlDemo
    URI QmlDemo
    VERSION 1.0
    QML_FILES
        Main.qml
        CounterButton.qml
)

target_link_libraries(QmlDemo PRIVATE Qt6::Quick)
```

`main.cpp`：

```cpp
#include <QGuiApplication>
#include <QQmlApplicationEngine>

int main(int argc, char *argv[])
{
    QGuiApplication app(argc, argv);
    QQmlApplicationEngine engine;
    engine.loadFromModule("QmlDemo", "Main");

    if (engine.rootObjects().isEmpty())
        return -1;

    return app.exec();
}
```

`CounterButton.qml`：

```qml
import QtQuick
import QtQuick.Controls

Button {
    id: root
    property int count: 0

    text: "点击次数：" + root.count
    onClicked: root.count++
}
```

`Main.qml`：

```qml
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

ApplicationWindow {
    width: 640
    height: 480
    visible: true
    title: "QML 示例"

    ColumnLayout {
        anchors {
            fill: parent
            margins: 24
        }
        spacing: 16

        Label {
            text: "欢迎学习 QML"
            font.pixelSize: 28
            Layout.alignment: Qt.AlignHCenter
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            color: "#f1f5f9"
            radius: 12

            CounterButton {
                anchors.centerIn: parent
            }
        }
    }
}
```

`qt_add_qml_module()` 会统一处理 QML 资源、模块元数据、类型信息和工具集成，是现代 Qt 6 项目的推荐方式。

## 19. 模块与单例

大型项目应把公共组件组织为模块：

```cmake
qt_add_qml_module(MyUi
    URI Company.Product.Ui
    QML_FILES
        PrimaryButton.qml
        UserCard.qml
        Theme.qml
)
```

使用时：

```qml
import Company.Product.Ui
```

QML 单例文件：

```qml
pragma Singleton
import QtQuick

QtObject {
    readonly property color primary: "#2563eb"
    readonly property color danger: "#dc2626"
    readonly property int spacingLarge: 24
}
```

CMake 中还需在 `qt_add_qml_module()` 前将该文件标记为 `QT_QML_SINGLETON_TYPE TRUE`。现代 CMake 工程通常自动生成 `qmldir`，不必手工维护。

## 20. 常见错误与最佳实践

1. **把绑定变成一次赋值。** 在事件处理器中执行 `width = ...` 会覆盖旧绑定；需要持续关系时应保留声明式绑定。
2. **绑定中产生副作用。** 绑定会反复计算，不要在其中修改状态或执行 I/O。
3. **混用几何管理方式。** anchors、Layout 与手工 `x/y` 不要控制同一个方向。
4. **滥用 `var`。** 明确类型能获得更好的工具检查和可维护性。
5. **delegate 保存持久状态。** delegate 会被销毁或复用，业务状态应进入 model。
6. **组件外部依赖内部 `id`。** 应通过 property、signal 和 function 建立公共接口。
7. **从 C++ 大量查找并操作 QML 对象。** 更好的方式是 C++ 暴露状态和命令，QML 用绑定更新界面。
8. **忽略 implicit size。** 自定义控件应合理提供 `implicitWidth` 和 `implicitHeight`，方便布局系统使用。
9. **忽略静态检查。** 定期运行 `qmllint`，及时处理未限定访问、错误信号和无效属性。

## 21. 调试与检查

日志：

```qml
console.log("普通日志")
console.info("信息")
console.warn("警告")
console.error("错误")
```

静态检查：

```bash
qmllint Main.qml
```

使用 `qt_add_qml_module()` 后，CMake 通常会生成 lint target：

```bash
cmake --build build --target all_qmllint
```

`qmllint` 可以发现语法错误、无效属性或信号、未限定属性访问、未使用导入、废弃 API，以及影响 QML 编译的问题。

## 22. 推荐学习路径

1. 掌握 `Item`、`Rectangle`、`Text`、`Image`。
2. 掌握 `id`、property 和属性绑定。
3. 学习 anchors、Row、Column 和 Layout。
4. 学习 signal、handler 和 function。
5. 使用 Qt Quick Controls 构建真实页面。
6. 封装带 `required property` 的自定义组件。
7. 掌握 `ListView`、model 和 delegate。
8. 学习 state、transition 和 animation。
9. 使用 `qt_add_qml_module()` 组织模块。
10. 使用 `QObject`、`Q_PROPERTY` 和 `QAbstractListModel` 接入 C++。

## 23. 官方参考资料

- [The QML Language](https://doc.qt.io/qt-6/qtqml-language-topic.html)
- [QML Object Attributes](https://doc.qt.io/qt-6/qtqml-syntax-objectattributes.html)
- [Import Statements](https://doc.qt.io/qt-6/qtqml-syntax-imports.html)
- [Binding QML Type](https://doc.qt.io/qt-6/qml-qtqml-binding.html)
- [QML Modules](https://doc.qt.io/qt-6/qtqml-modules-topic.html)
- [ListView QML Type](https://doc.qt.io/qt-6/qml-qtquick-listview.html)
- [QML and C++ Integration](https://doc.qt.io/qt-6/qtqml-cppintegration-overview.html)
- [Exposing Attributes of C++ Types to QML](https://doc.qt.io/qt-6/qtqml-cppintegration-exposecppattributes.html)
- [qmllint](https://doc.qt.io/qt-6/qtqml-tooling-qmllint.html)

QML 真正的优势不是少写几行界面代码，而是把“状态之间的关系”直接写进界面定义中。只要始终保持数据源清晰、绑定单向、组件接口明确，QML 项目即使规模扩大，也能保持良好的可读性和可维护性。

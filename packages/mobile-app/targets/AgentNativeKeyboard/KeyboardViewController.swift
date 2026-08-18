import UIKit

final class KeyboardViewController: UIInputViewController {
  private let appGroup = "group.com.agentnative.mobile"
  private let activeRequestKey = "keyboard.activeRequestId"
  private let resultRequestKey = "keyboard.resultRequestId"
  private let resultTextKey = "keyboard.latestText"
  private let insertedRequestKey = "keyboard.lastInsertedRequestId"

  private let statusLabel = UILabel()
  private let dictateButton = UIButton(type: .system)
  private let insertButton = UIButton(type: .system)
  private var refreshTimer: Timer?

  override func viewDidLoad() {
    super.viewDidLoad()
    buildInterface()
    refreshState()
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    refreshTimer?.invalidate()
    refreshTimer = Timer.scheduledTimer(
      withTimeInterval: 0.75,
      repeats: true
    ) { [weak self] _ in
      self?.refreshState()
    }
  }

  override func viewWillDisappear(_ animated: Bool) {
    refreshTimer?.invalidate()
    refreshTimer = nil
    super.viewWillDisappear(animated)
  }

  private func buildInterface() {
    view.backgroundColor = UIColor(red: 0.05, green: 0.05, blue: 0.06, alpha: 1)

    statusLabel.font = .preferredFont(forTextStyle: .caption1)
    statusLabel.textColor = .secondaryLabel
    statusLabel.numberOfLines = 2
    statusLabel.textAlignment = .center

    configurePrimaryButton(dictateButton, title: "Dictate in Agent Native")
    dictateButton.addTarget(self, action: #selector(beginDictation), for: .touchUpInside)

    configurePrimaryButton(insertButton, title: "Insert Dictation")
    insertButton.addTarget(self, action: #selector(insertDictation), for: .touchUpInside)

    let deleteButton = keyButton(title: "⌫", action: #selector(deleteBackward))
    let spaceButton = keyButton(title: "space", action: #selector(insertSpace))
    let returnButton = keyButton(title: "return", action: #selector(insertReturn))
    let nextKeyboardButton = keyButton(title: "globe", action: #selector(showKeyboardList(_:)))
    nextKeyboardButton.addTarget(
      self,
      action: #selector(showKeyboardList(_:)),
      for: .allTouchEvents
    )

    let editingRow = UIStackView(
      arrangedSubviews: [nextKeyboardButton, deleteButton, spaceButton, returnButton]
    )
    editingRow.axis = .horizontal
    editingRow.spacing = 8
    editingRow.distribution = .fillEqually

    let actions = UIStackView(arrangedSubviews: [dictateButton, insertButton])
    actions.axis = .horizontal
    actions.spacing = 10
    actions.distribution = .fillEqually

    let stack = UIStackView(arrangedSubviews: [statusLabel, actions, editingRow])
    stack.axis = .vertical
    stack.spacing = 10
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)

    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
      stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
      stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 12),
      stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -10),
      dictateButton.heightAnchor.constraint(equalToConstant: 48),
      editingRow.heightAnchor.constraint(equalToConstant: 42),
    ])
  }

  private func configurePrimaryButton(_ button: UIButton, title: String) {
    var configuration = UIButton.Configuration.filled()
    configuration.title = title
    configuration.baseBackgroundColor = UIColor(red: 0.78, green: 0.95, blue: 0.42, alpha: 1)
    configuration.baseForegroundColor = .black
    configuration.cornerStyle = .large
    button.configuration = configuration
  }

  private func keyButton(title: String, action: Selector) -> UIButton {
    let button = UIButton(type: .system)
    var configuration = UIButton.Configuration.gray()
    configuration.title = title
    configuration.baseForegroundColor = .label
    configuration.cornerStyle = .medium
    button.configuration = configuration
    if title != "globe" {
      button.addTarget(self, action: action, for: .touchUpInside)
    }
    return button
  }

  private var sharedDefaults: UserDefaults? {
    UserDefaults(suiteName: appGroup)
  }

  private func refreshState() {
    guard hasFullAccess else {
      statusLabel.text = "Allow Full Access in Keyboard Settings to hand off dictation securely."
      dictateButton.isEnabled = false
      insertButton.isEnabled = false
      return
    }

    dictateButton.isEnabled = true
    let activeRequest = sharedDefaults?.string(forKey: activeRequestKey)
    let resultRequest = sharedDefaults?.string(forKey: resultRequestKey)
    let insertedRequest = sharedDefaults?.string(forKey: insertedRequestKey)
    let text = sharedDefaults?.string(forKey: resultTextKey)?.trimmingCharacters(
      in: .whitespacesAndNewlines
    )
    let canInsert = activeRequest != nil
      && activeRequest == resultRequest
      && resultRequest != insertedRequest
      && !(text?.isEmpty ?? true)
    insertButton.isEnabled = canInsert
    statusLabel.text = canInsert
      ? "Your dictation is ready at the cursor."
      : "Record in Agent Native, return here, then insert once."
  }

  @objc private func beginDictation() {
    guard hasFullAccess else {
      return
    }
    let requestId = UUID().uuidString.lowercased()
    sharedDefaults?.set(requestId, forKey: activeRequestKey)
    sharedDefaults?.removeObject(forKey: resultRequestKey)
    sharedDefaults?.removeObject(forKey: resultTextKey)
    let encodedRequest = requestId.addingPercentEncoding(
      withAllowedCharacters: .urlQueryAllowed
    ) ?? requestId
    guard let url = URL(
      string: "agentnative://capture/dictate?source=keyboard&requestId=\(encodedRequest)"
    ) else {
      return
    }
    extensionContext?.open(url) { [weak self] opened in
      DispatchQueue.main.async {
        self?.statusLabel.text = opened
          ? "Finish dictating, return to this field, and tap Insert."
          : "Open Agent Native and choose Dictate, then return here."
      }
    }
  }

  @objc private func insertDictation() {
    let activeRequest = sharedDefaults?.string(forKey: activeRequestKey)
    let resultRequest = sharedDefaults?.string(forKey: resultRequestKey)
    let insertedRequest = sharedDefaults?.string(forKey: insertedRequestKey)
    guard activeRequest == resultRequest,
      resultRequest != insertedRequest,
      let requestId = resultRequest,
      let text = sharedDefaults?.string(forKey: resultTextKey),
      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      refreshState()
      return
    }
    textDocumentProxy.insertText(text)
    sharedDefaults?.set(requestId, forKey: insertedRequestKey)
    refreshState()
  }

  @objc private func deleteBackward() {
    textDocumentProxy.deleteBackward()
  }

  @objc private func insertSpace() {
    textDocumentProxy.insertText(" ")
  }

  @objc private func insertReturn() {
    textDocumentProxy.insertText("\n")
  }

  @objc private func showKeyboardList(_ sender: UIButton) {
    handleInputModeList(from: sender, with: UIEvent())
  }
}

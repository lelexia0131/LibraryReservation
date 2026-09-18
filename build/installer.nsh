!include "nsDialogs.nsh"

; Disable the unconditional builder shortcut. Our explicit opt-in page owns it.
!ifndef BUILD_UNINSTALLER
!define DO_NOT_CREATE_DESKTOP_SHORTCUT
Var desktopCheckbox
Var desktopChoice
!endif

!macro customInit
  StrCpy $desktopChoice ${BST_UNCHECKED}
!macroend

!macro customPageAfterChangeDir
  Page custom DesktopShortcutPage DesktopShortcutLeave

Function DesktopShortcutPage
  !insertmacro MUI_HEADER_TEXT "快捷方式" "选择是否在桌面创建快捷方式。"
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateCheckbox} 0 16u 100% 20u "创建桌面快捷方式"
  Pop $desktopCheckbox
  ${NSD_SetState} $desktopCheckbox $desktopChoice
  nsDialogs::Show
FunctionEnd

Function DesktopShortcutLeave
  ${NSD_GetState} $desktopCheckbox $desktopChoice
FunctionEnd
!macroend

!macro customInstall
  ${If} $desktopChoice == ${BST_CHECKED}
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${EndIf}
!macroend

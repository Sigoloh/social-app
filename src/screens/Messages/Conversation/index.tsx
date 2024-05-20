import React, {useCallback} from 'react'
import {View} from 'react-native'
import {AppBskyActorDefs, moderateProfile, ModerationOpts} from '@atproto/api'
import {msg} from '@lingui/macro'
import {useLingui} from '@lingui/react'
import {useFocusEffect} from '@react-navigation/native'
import {NativeStackScreenProps} from '@react-navigation/native-stack'

import {CommonNavigatorParams} from '#/lib/routes/types'
import {useGate} from '#/lib/statsig/statsig'
import {useCurrentConvoId} from '#/state/messages/current-convo-id'
import {useModerationOpts} from '#/state/preferences/moderation-opts'
import {useProfileQuery} from '#/state/queries/profile'
import {isWeb} from 'platform/detection'
import {useProfileShadow} from 'state/cache/profile-shadow'
import {ConvoProvider, isConvoActive, useConvo} from 'state/messages/convo'
import {ConvoStatus} from 'state/messages/convo/types'
import {useSetMinimalShellMode} from 'state/shell'
import {CenteredView} from 'view/com/util/Views'
import {MessagesList} from '#/screens/Messages/Conversation/MessagesList'
import {atoms as a, useBreakpoints, useTheme} from '#/alf'
import {MessagesListBlockedFooter} from '#/components/dms/MessagesListBlockedFooter'
import {MessagesListHeader} from '#/components/dms/MessagesListHeader'
import {Error} from '#/components/Error'
import {Loader} from '#/components/Loader'
import {ClipClopGate} from '../gate'

type Props = NativeStackScreenProps<
  CommonNavigatorParams,
  'MessagesConversation'
>
export function MessagesConversationScreen({route}: Props) {
  const gate = useGate()
  const {gtMobile} = useBreakpoints()
  const setMinimalShellMode = useSetMinimalShellMode()

  const convoId = route.params.conversation
  const {setCurrentConvoId} = useCurrentConvoId()

  useFocusEffect(
    useCallback(() => {
      setCurrentConvoId(convoId)

      if (isWeb && !gtMobile) {
        setMinimalShellMode(true)
      } else {
        setMinimalShellMode(false)
      }

      return () => {
        setCurrentConvoId(undefined)
        setMinimalShellMode(false)
      }
    }, [gtMobile, convoId, setCurrentConvoId, setMinimalShellMode]),
  )

  if (!gate('dms')) return <ClipClopGate />

  return (
    <ConvoProvider convoId={convoId}>
      <Inner />
    </ConvoProvider>
  )
}

function Inner() {
  const t = useTheme()
  const convoState = useConvo()
  const {_} = useLingui()

  const moderationOpts = useModerationOpts()
  const {data: recipient} = useProfileQuery({
    did: convoState.recipients?.[0].did,
  })

  // Because we want to give the list a chance to asynchronously scroll to the end before it is visible to the user,
  // we use `hasScrolled` to determine when to render. With that said however, there is a chance that the chat will be
  // empty. So, we also check for that possible state as well and render once we can.
  const [hasScrolled, setHasScrolled] = React.useState(false)
  const readyToShow =
    hasScrolled ||
    (convoState.status === ConvoStatus.Ready &&
      !convoState.isFetchingHistory &&
      convoState.items.length === 0)

  // Any time that we re-render the `Initializing` state, we have to reset `hasScrolled` to false. After entering this
  // state, we know that we're resetting the list of messages and need to re-scroll to the bottom when they get added.
  React.useEffect(() => {
    if (convoState.status === ConvoStatus.Initializing) {
      setHasScrolled(false)
    }
  }, [convoState.status])

  if (convoState.status === ConvoStatus.Error) {
    return (
      <CenteredView style={a.flex_1} sideBorders>
        <MessagesListHeader />
        <Error
          title={_(msg`Something went wrong`)}
          message={_(msg`We couldn't load this conversation`)}
          onRetry={() => convoState.error.retry()}
        />
      </CenteredView>
    )
  }

  return (
    <CenteredView style={[a.flex_1]} sideBorders>
      {!readyToShow && <MessagesListHeader />}
      <View style={[a.flex_1]}>
        {moderationOpts && recipient ? (
          <InnerReady
            moderationOpts={moderationOpts}
            recipient={recipient}
            hasScrolled={hasScrolled}
            setHasScrolled={setHasScrolled}
          />
        ) : (
          <>
            <View style={[a.align_center, a.gap_sm, a.flex_1]} />
          </>
        )}
        {!readyToShow && (
          <View
            style={[
              a.absolute,
              a.z_10,
              a.w_full,
              a.h_full,
              a.justify_center,
              a.align_center,
              t.atoms.bg,
            ]}>
            <View style={[{marginBottom: 75}]}>
              <Loader size="xl" />
            </View>
          </View>
        )}
      </View>
    </CenteredView>
  )
}

function InnerReady({
  moderationOpts,
  recipient: recipientUnshadowed,
  hasScrolled,
  setHasScrolled,
}: {
  moderationOpts: ModerationOpts
  recipient: AppBskyActorDefs.ProfileViewBasic
  hasScrolled: boolean
  setHasScrolled: React.Dispatch<React.SetStateAction<boolean>>
}) {
  const convoState = useConvo()
  const recipient = useProfileShadow(recipientUnshadowed)

  const moderation = React.useMemo(() => {
    return moderateProfile(recipient, moderationOpts)
  }, [recipient, moderationOpts])

  const blockInfo = React.useMemo(() => {
    const modui = moderation.ui('profileView')
    const blocks = modui.alerts.filter(alert => alert.type === 'blocking')
    const listBlocks = blocks.filter(alert => alert.source.type === 'list')
    const userBlock = blocks.find(alert => alert.source.type === 'user')
    return {
      listBlocks,
      userBlock,
    }
  }, [moderation])

  return (
    <>
      <MessagesListHeader
        profile={recipient}
        moderation={moderation}
        blockInfo={blockInfo}
      />
      {isConvoActive(convoState) && (
        <MessagesList
          hasScrolled={hasScrolled}
          setHasScrolled={setHasScrolled}
          blocked={moderation?.blocked}
          footer={
            <MessagesListBlockedFooter
              recipient={recipient}
              convoId={convoState.convo.id}
              hasMessages={convoState.items.length > 0}
              blockInfo={blockInfo}
            />
          }
        />
      )}
    </>
  )
}
